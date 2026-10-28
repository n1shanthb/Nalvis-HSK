import type { Evidence, EngineState, Quote } from './types.js';
import type { Mandate, Policy } from './policy.js';
import { units } from './policy.js';

export function quality(e: Evidence, p: Policy): string {
  const q = p.dataQuality;
  if (Object.values(e.sources).some((s) => s.error !== undefined))
    return 'source_error';
  if (
    !e.dexMid ||
    units(e.dexMid, 18) === 0n ||
    e.lastSwapAt === undefined ||
    e.lastSwapAt > e.now ||
    e.now - e.lastSwapAt > q.maxDexStaleSec
  )
    return 'dex_stale_or_missing';
  if (e.cex.length !== 2 || new Set(e.cex.map((c) => c.venue)).size !== 2)
    return 'cex_missing';
  if (
    e.cex.some(
      (c) =>
        c.ask < c.bid ||
        c.fetchedAt > e.now ||
        e.now - c.fetchedAt > q.maxCexAgeSec ||
        (c.ask / c.bid - 1) * 10000 > q.cexMaxSpreadBps,
    )
  )
    return 'cex_quality';
  const mids = e.cex.map((c) => (c.ask + c.bid) / 2);
  if (
    (Math.max(...mids) / Math.min(...mids) - 1) * 10000 >
    q.maxCexVenueDivergenceBps
  )
    return 'cex_divergence';
  if (
    !e.apro ||
    e.apro.updatedAt > e.now ||
    e.apro.ageSec !== e.now - e.apro.updatedAt
  )
    return 'apro_missing_or_invalid';
  if (
    e.quotes.some((quote) => {
      const fair = fairOutFor(quote, e);
      return (
        fair <= 0n ||
        Math.abs(1 - Number(quote.quotedOut) / Number(fair)) * 10000 >
          q.maxQuoteVsMidBps
      );
    })
  )
    return 'quote_vs_mid';
  return '';
}
export const cexMid = (e: Evidence) =>
  e.cex.reduce((sum, c) => sum + (c.bid + c.ask) / 2, 0) / e.cex.length;
export function valueA(amount: bigint, e: Evidence): bigint {
  return (
    (amount * units(e.dexMid!, 18) * 10n ** BigInt(e.decimalsB)) /
    (10n ** BigInt(e.decimalsA) * 10n ** 18n)
  );
}
export function inputFor(
  direction: 'BUY_A' | 'SELL_A',
  sizeB: number,
  e: Evidence,
): bigint {
  const b = units(sizeB, e.decimalsB);
  return direction === 'BUY_A'
    ? b
    : (b * 10n ** BigInt(e.decimalsA) * 10n ** 18n) /
        (units(e.dexMid!, 18) * 10n ** BigInt(e.decimalsB));
}
export function evaluateQuote(
  q: Quote,
  e: Evidence,
  p: Policy,
  m: Mandate,
  s: EngineState,
  spent: bigint,
  basis: number,
) {
  const buy = q.direction === 'BUY_A';
  const bIn = buy ? q.amountIn : valueA(q.amountIn, e);
  const fairOut = fairOutFor(q, e);
  const cost = 1 - Number(q.quotedOut) / Number(fairOut);
  const minQuote = (q.quotedOut * BigInt(10000 - m.maxSlippageBps)) / 10000n;
  const minOut =
    q.twapFloor === undefined || q.twapFloor < minQuote
      ? minQuote
      : q.twapFloor;
  const a = s.balanceA + (buy ? q.quotedOut : -q.amountIn);
  const b = s.balanceB + (buy ? -q.amountIn : q.quotedOut);
  const preA = valueA(s.balanceA, e),
    postA = valueA(a, e);
  const preTotal = preA + s.balanceB,
    postTotal = postA + b;
  const exposureOK =
    postA * 10000n <= postTotal * BigInt(m.maxExposureBps) ||
    postA * preTotal < preA * postTotal;
  const valid =
    q.amountIn === inputFor(q.direction, q.sizeB, e) &&
    bIn > 0n &&
    fairOut > 0n &&
    q.amountIn <= (buy ? m.maxTradeInB : m.maxTradeInA) &&
    spent + bIn <= m.maxDailyInB &&
    a >= 0n &&
    b >= 0n &&
    exposureOK &&
    minOut > 0n &&
    minOut <= q.quotedOut &&
    Math.abs(cost) * 10000 <= p.dataQuality.maxQuoteVsMidBps &&
    Math.abs(basis) - cost - p.presets[s.preset].edgeBufferBps / 10000 > 0;
  return { valid, minOut, cost };
}

function fairOutFor(q: Quote, e: Evidence): bigint {
  return q.direction === 'BUY_A'
    ? (q.amountIn * 10n ** BigInt(e.decimalsA) * 10n ** 18n) /
        (units(e.dexMid!, 18) * 10n ** BigInt(e.decimalsB))
    : valueA(q.amountIn, e);
}
