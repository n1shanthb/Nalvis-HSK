import type { Hour } from './reference.js';
import { round2 } from './reference.js';
import { decideLegacy as decide } from '../engine.js';
import { inputFor } from '../engine-helpers.js';
import { policyHash, units, type Policy, type Mandate } from '../policy.js';
import type { Evidence, EngineState } from '../types.js';
export type MeasuredCurve = { usdtIn: number; roundTripCostPct: number }[];
/** Fixed measured calibration only. Interpolate within the measured domain, never extrapolate. */
export function measuredCost(size: number, curve: MeasuredCurve): number {
  const sorted = [...curve].sort((a, b) => a.usdtIn - b.usdtIn);
  const hi = sorted.findIndex((q) => q.usdtIn >= size);
  if (hi < 0 || size < sorted[0].usdtIn)
    throw new Error('Outside measured curve');
  if (sorted[hi].usdtIn === size) return sorted[hi].roundTripCostPct / 200;
  const lo = sorted[hi - 1],
    h = sorted[hi];
  return (
    (lo.roundTripCostPct +
      ((h.roundTripCostPct - lo.roundTripCostPct) * (size - lo.usdtIn)) /
        (h.usdtIn - lo.usdtIn)) /
    200
  );
}
export function replay(history: Hour[], curve: MeasuredCurve, policy: Policy) {
  if (!history.length) throw new Error('Empty history');
  const m: Mandate = {
    expiry: history[0].hour + 31 * 86400,
    revoked: false,
    maxTradeInA: units('1000000', 18),
    maxTradeInB: units('100', 6),
    maxDailyInB: units('1000', 6),
    maxExposureBps: 10000,
    maxSlippageBps: 100,
    minIntervalSec: 0,
    policyHash: policyHash(policy),
  };
  const state: EngineState = {
    preset: 'balanced',
    balanceA: units(500 / history[0].dex, 18),
    balanceB: units(500, 6),
    lastTradeAt: 0,
    dailySpentB: 0n,
    dailyBucket: 0,
    dailyLossB: 0,
    llmValid: true,
  };
  const counts = { TRADE: 0, RESIZE: 0, WAIT: 0, REJECT: 0 };
  let last = history[0].dex,
    lastSwapAt = history[0].hour,
    peak = 1000,
    mdd = 0,
    dayStart = 1000;
  for (const x of history) {
    if (x.dex !== last) {
      last = x.dex;
      lastSwapAt = x.hour;
    }
    const e: Evidence = {
      marketDataChainId: 177,
      executionChainId: 31337,
      blockNumber: 0n,
      executionBlockNumber: 0n,
      now: x.hour,
      decimalsA: 18,
      decimalsB: 6,
      dexMid: x.dex,
      lastSwapAt,
      cex: [
        { venue: 'mexc', bid: x.cex, ask: x.cex, fetchedAt: x.hour },
        { venue: 'gate', bid: x.cex, ask: x.cex, fetchedAt: x.hour },
      ],
      apro: { price: x.cex, updatedAt: 0, ageSec: x.hour },
      quotes: [],
      sources: {
        synthetic: {
          url: 'fixture:market_history.json+hsk_probe.json',
          method: 'synthetic retrospective calibration',
          raw: x,
          fetchedAt: x.hour,
        },
      },
    };
    for (const sizeB of policy.presets.balanced.sizeGridB)
      for (const direction of ['BUY_A', 'SELL_A'] as const) {
        const amountIn = inputFor(direction, sizeB, e),
          cost = measuredCost(sizeB, curve);
        const out =
          direction === 'BUY_A'
            ? (sizeB / x.dex) * (1 - cost)
            : sizeB * (1 - cost);
        e.quotes.push({
          direction,
          sizeB,
          amountIn,
          quotedOut: units(out, direction === 'BUY_A' ? 18 : 6),
        });
      }
    const before =
      Number(state.balanceB) / 1e6 + (Number(state.balanceA) / 1e18) * x.dex;
    if (state.dailyBucket !== Math.floor(x.hour / 86400)) {
      state.dailySpentB = 0n;
      state.dailyBucket = Math.floor(x.hour / 86400);
      dayStart = before;
    }
    state.dailyLossB = Math.max(0, dayStart - before);
    const decision = decide(e, policy, m, state);
    counts[decision.kind]++;
    if (decision.kind === 'TRADE' || decision.kind === 'RESIZE') {
      const quote = e.quotes.find(
        (q) => q.direction === decision.direction && q.sizeB === decision.sizeB,
      )!;
      if (decision.direction === 'BUY_A') {
        state.balanceB -= quote.amountIn;
        state.balanceA += quote.quotedOut;
      } else {
        state.balanceA -= quote.amountIn;
        state.balanceB += quote.quotedOut;
      }
      state.lastTradeAt = x.hour;
      state.dailySpentB += units(decision.sizeB!, 6);
    }
    const equity =
      Number(state.balanceB) / 1e6 + (Number(state.balanceA) / 1e18) * x.dex;
    peak = Math.max(peak, equity);
    mdd = Math.max(mdd, (peak - equity) / peak);
  }
  const end = history.at(-1)!;
  const equity =
      Number(state.balanceB) / 1e6 + (Number(state.balanceA) / 1e18) * end.dex,
    hold = 500 + (500 / history[0].dex) * end.dex;
  return {
    label: 'Synthetic engine replay: no proven edge',
    hours: history.length,
    counts,
    finalEquityDex: round2(equity),
    holdDex: round2(hold),
    excessVsHoldDex: round2(equity - hold),
    maxDrawdownPct: round2(mdd * 100),
    limitations:
      'Fixed ex-post measured round-trip/2 curve; no future history rows used by decisions. Historical two-venue books, APRO, block state and size quotes unavailable: explicitly synthetic. Gas and impact on subsequent prices excluded; marks before exit cost. Not evidence of profitability.',
  };
}
