/** Faithful port of frozen backtest_reference.py; these constants belong to that reference only. */
export const CLIP = 100,
  COST = 0.00345,
  GAS = 0.006,
  STALE_H = 6;
export type Hour = {
  hour: number;
  dex: number;
  cex: number;
  basis_pct: number;
};
type Signal = (
  data: Hour[],
  i: number,
  stale: number,
) => 'BUY' | 'SELL' | 'REJECT' | null;
export type Metrics = {
  final_equity: number;
  hold_5050_equity: number;
  excess_vs_hold: number;
  trades: number;
  rejected_signals: number;
  max_drawdown_pct: number;
};
/** Python round(x,2): round the exact binary double, not a rounded x*100 intermediate. */
export function round2(x: number): number {
  if (!Number.isFinite(x)) throw new Error('Non-finite round');
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0);
  const exp = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) + (exp === 0 ? 0n : 1n << 52n);
  const power = (exp === 0 ? -1022 : exp - 1023) - 52;
  let n = mantissa * 100n,
    d = 1n;
  if (power >= 0) n <<= BigInt(power);
  else d <<= BigInt(-power);
  let q = n / d;
  const r = n % d;
  if (r * 2n > d || (r * 2n === d && q % 2n === 1n)) q++;
  return ((x < 0 ? -1 : 1) * Number(q)) / 100;
}
// Python statistics.mean sums floats exactly before the final division. A compensated sum
// preserves its decisions for this fixture; parity covers every strategy and selected threshold.
export function meanPast(d: Hour[], i: number, n: number) {
  const xs = d.slice(Math.max(0, i - n), i).map((x) => x.dex);
  if (!xs.length) return d[i].dex;
  let sum = 0,
    c = 0;
  for (const x of xs) {
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return (sum + c) / xs.length;
}
export const A =
  (th: number): Signal =>
  (d, i) =>
    d[i].dex <= meanPast(d, i, 24) * (1 - th)
      ? 'BUY'
      : d[i].dex >= meanPast(d, i, 24) * (1 + th)
        ? 'SELL'
        : null;
export const B =
  (th: number): Signal =>
  (d, i, s) => {
    const a = A(Math.max(th, 2 * COST + 0.002))(d, i, s);
    return a && s > STALE_H ? 'REJECT' : a;
  };
export const D =
  (th: number): Signal =>
  (d, i, s) => {
    const b = d[i].basis_pct / 100;
    return Math.abs(b) <= th
      ? null
      : s > STALE_H
        ? 'REJECT'
        : b < 0
          ? 'BUY'
          : 'SELL';
  };
export function run(
  signal: Signal,
  data: Hour[],
  startUsdt = 500,
  startWhskUsd = 500,
  mark: 'cex' | 'dex' = 'cex',
): Metrics {
  let usdt = startUsdt,
    whsk = startWhskUsd / data[0].dex,
    trades = 0,
    rejects = 0,
    lastDex: number | null = null,
    lastChange = 0;
  const eq: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    if (lastDex !== x.dex) {
      lastChange = i;
      lastDex = x.dex;
    }
    const s = signal(data, i, i - lastChange);
    if (s === 'BUY' && usdt >= CLIP) {
      usdt -= CLIP + GAS;
      whsk += (CLIP * (1 - COST)) / x.dex;
      trades++;
    } else if (s === 'SELL' && whsk * x.dex >= CLIP) {
      const q = CLIP / x.dex;
      whsk -= q;
      usdt += CLIP * (1 - COST) - GAS;
      trades++;
    } else if (s === 'REJECT') rejects++;
    eq.push(usdt + whsk * (mark === 'cex' ? x.cex : x.dex * (1 - COST)));
  }
  const last = data[data.length - 1];
  const hold =
    startUsdt +
    (startWhskUsd / data[0].dex) *
      (mark === 'cex' ? last.cex : last.dex * (1 - COST));
  let peak = -1e9,
    mdd = 0;
  for (const e of eq) {
    peak = Math.max(peak, e);
    mdd = Math.max(mdd, (peak - e) / peak);
  }
  return {
    final_equity: round2(eq.at(-1)!),
    hold_5050_equity: round2(hold),
    excess_vs_hold: round2(eq.at(-1)! - hold),
    trades,
    rejected_signals: rejects,
    max_drawdown_pct: round2(mdd * 100),
  };
}
export function reference(history: Hour[]) {
  const half = Math.floor(history.length / 2),
    ins = history.slice(0, half),
    oos = history.slice(half),
    grid = [0.005, 0.01, 0.015, 0.02];
  const results: Record<string, unknown> = {};
  for (const [name, fn] of [
    ['A_fixed_band', A],
    ['B_risk_aware_band', B],
    ['D_dislocation', D],
  ] as const) {
    let best = grid[0];
    for (const t of grid.slice(1))
      if (run(fn(t), ins).excess_vs_hold > run(fn(best), ins).excess_vs_hold)
        best = t;
    results[name] = {
      threshold_chosen_in_sample: best,
      in_sample: run(fn(best), ins),
      out_of_sample: run(fn(best), oos),
      full_grid_oos: Object.fromEntries(
        grid.map((t) => [String(t), run(fn(t), oos)]),
      ),
      out_of_sample_dex_mark: run(fn(best), oos, 500, 500, 'dex'),
      in_sample_dex_mark: run(fn(best), ins, 500, 500, 'dex'),
    };
  }
  return {
    note: 'Replay only; NOT evidence of profitability (30 days, single pool, one dominant counterparty, stale-hour fills assumed).',
    in_sample_hours: ins.length,
    oos_hours: oos.length,
    results,
  };
}
