import type { Evidence, Quote } from './types.js';
/** Seeded, symmetric bounded Monte Carlo stress of the measured QuoterV2 cost curve.
 * Price shock is bounded by historical +/- sigma; this is a stress proxy, not a new RPC quote.
 * No randomness or clock I/O. Each size is evaluated independently; engine iterates down only.
 */
export function riskCheck(e: Evidence, q: Quote, bufferBps: number) {
  const sigma = e.riskInput!.sigma;
  let seed = 0x4e414c56,
    worst = 0;
  const buy = q.direction === 'BUY_A';
  const fair =
    (Number(q.amountIn) / 10 ** (buy ? e.decimalsB : e.decimalsA)) *
    (buy ? 1 / e.dexMid! : e.dexMid!);
  const output = Number(q.quotedOut) / 10 ** (buy ? e.decimalsA : e.decimalsB);
  const mid = e.cex.reduce((n, c) => n + (c.bid + c.ask) / 2, 0) / e.cex.length;
  const basisBps = Math.abs(e.dexMid! / mid - 1) * 10000;
  for (let i = 0; i < 256; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    // Include endpoints, then fixed uniform draws. Input amount and quoted cost curve stay fixed.
    const shock =
      (i === 0 ? -1 : i === 1 ? 1 : (seed / 0xffffffff) * 2 - 1) * sigma;
    const stressedFair = fair * (buy ? 1 / (1 + shock) : 1 + shock);
    worst = Math.max(worst, (1 - output / stressedFair) * 10000);
  }
  return {
    samples: 256,
    sigma,
    worstCostBps: worst,
    accepted: Number.isFinite(worst) && basisBps > worst + bufferBps,
  };
}
