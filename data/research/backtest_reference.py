# Hourly, no-look-ahead replay on ../raw/market_history.json (30d). Costs: measured one-way cost curve for WHSK/USDT 0.3% pool
# (QuoterV2 27/10/2026 21:30 IST: $10 0.304%, $100 ~0.345%, $500 ~0.52%) + gas ~$0.006/swap. Execution assumed at hour-end DEX price
# (last swap) adjusted by cost; this IGNORES that our own trade moves later prices and that the hour-end price may be stale.
# Strategies: A fixed-band (rule), B risk-aware (band + cost/liquidity/staleness gates), D dislocation (DEX vs CEX basis).
import json, statistics as st
H = json.load(open("market_history.json"))["basis_series"]
CLIP = 100.0; COST = 0.00345; GAS = 0.006; STALE_H = 6
def run(signal, data, start_usdt=500.0, start_whsk_usd=500.0, mark="cex"):
    usdt = start_usdt; whsk = start_whsk_usd / data[0]["dex"]; trades = 0; rejects = 0; eq = []; last_dex = None; last_change = 0
    for i, x in enumerate(data):
        if last_dex != x["dex"]: last_change = i; last_dex = x["dex"]
        stale_h = i - last_change
        s = signal(data, i, stale_h)
        if s == "BUY" and usdt >= CLIP:
            usdt -= CLIP + GAS; whsk += CLIP * (1 - COST) / x["dex"]; trades += 1
        elif s == "SELL" and whsk * x["dex"] >= CLIP:
            q = CLIP / x["dex"]; whsk -= q; usdt += CLIP * (1 - COST) - GAS; trades += 1
        elif s == "REJECT": rejects += 1
        eq.append(usdt + whsk * (x["cex"] if mark == "cex" else x["dex"] * (1 - COST)))  # cex = fair-value proxy; dex = realisable on HSKSwap after exit cost
    hold = start_usdt + start_whsk_usd / data[0]["dex"] * (data[-1]["cex"] if mark == "cex" else data[-1]["dex"] * (1 - COST))
    peak = -1e9; mdd = 0
    for e in eq: peak = max(peak, e); mdd = max(mdd, (peak - e) / peak)
    return {"final_equity": round(eq[-1], 2), "hold_5050_equity": round(hold, 2), "excess_vs_hold": round(eq[-1] - hold, 2), "trades": trades, "rejected_signals": rejects, "max_drawdown_pct": round(mdd * 100, 2)}
def mean_past(d, i, n): xs = [y["dex"] for y in d[max(0, i - n):i]]; return st.mean(xs) if xs else d[i]["dex"]
def A(th):  # fixed rule: buy if DEX price <= 24h mean*(1-th), sell if >= (1+th). No cost/liquidity checks.
    return lambda d, i, s: ("BUY" if d[i]["dex"] <= mean_past(d, i, 24) * (1 - th) else "SELL" if d[i]["dex"] >= mean_past(d, i, 24) * (1 + th) else None)
def B(th):  # risk-aware: same band but require move > round-trip cost+buffer and DEX price not stale
    def f(d, i, s):
        a = A(max(th, 2 * COST + 0.002))(d, i, s)
        if a and s > STALE_H: return "REJECT"
        return a
    return f
def D(th):  # dislocation: basis = DEX/CEX-1; buy WHSK on DEX when DEX cheap, sell when rich; reject if stale
    def f(d, i, s):
        b = d[i]["basis_pct"] / 100
        if abs(b) <= th: return None
        if s > STALE_H: return "REJECT"
        return "BUY" if b < 0 else "SELL"
    return f
half = len(H) // 2; ins, oos = H[:half], H[half:]
res = {"note": "Replay only; NOT evidence of profitability (30 days, single pool, one dominant counterparty, stale-hour fills assumed).", "in_sample_hours": len(ins), "oos_hours": len(oos), "results": {}}
grid = [0.005, 0.01, 0.015, 0.02]
for name, fn in [("A_fixed_band", A), ("B_risk_aware_band", B), ("D_dislocation", D)]:
    best = max(grid, key=lambda t: run(fn(t), ins)["excess_vs_hold"])
    res["results"][name] = {"threshold_chosen_in_sample": best, "in_sample": run(fn(best), ins), "out_of_sample": run(fn(best), oos), "full_grid_oos": {str(t): run(fn(t), oos) for t in grid}, "out_of_sample_dex_mark": run(fn(best), oos, mark="dex"), "in_sample_dex_mark": run(fn(best), ins, mark="dex")}
json.dump(res, open("backtest.json", "w"), indent=1)
for k, v in res["results"].items(): print(k, "th", v["threshold_chosen_in_sample"], "\n IS", v["in_sample"], "\n OOS", v["out_of_sample"], "\n OOS dex-mark", v["out_of_sample_dex_mark"], "\n IS dex-mark", v["in_sample_dex_mark"])
