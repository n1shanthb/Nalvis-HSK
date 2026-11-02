import { z } from 'zod';
import { units } from '../../../../packages/core/src/policy.js';
import type { Evidence } from '../../../../packages/core/src/types.js';
import type { ActionView } from '../agent/feed-types.js';
import type { Verification } from '../../../../packages/verifier/src/verify.js';
import { pnl } from '../../../../packages/verifier/src/pnl.js';
export const sources = {
  market: 'LIVE · mainnet 177',
  execution: 'LIVE · testnet 133',
  recorded: 'RECORDED · mainnet 177 (27/10/2026)',
  demo: 'DEMO · recorded local anvil',
  agentSnapshot: 'RECORDED · agent snapshot',
  agentObservation: 'LAST OBSERVATION · agent feed',
  agentUnavailable: 'UNAVAILABLE · agent feed',
} as const;
export type ChartSource = (typeof sources)[keyof typeof sources];
export type Point = { time: number; value: number };
export const historySchema = z.object({
  basis_series: z
    .array(
      z.object({
        hour: z.number().int().nonnegative(),
        dex: z.number().finite().positive(),
        cex: z.number().finite().positive(),
        basis_pct: z.number().finite(),
      }),
    )
    .min(1),
});
export function loadHistory(input: unknown) {
  const rows = historySchema.parse(input).basis_series;
  if (rows.some((r, i) => i > 0 && r.hour <= rows[i - 1].hour))
    throw Error('History must be strictly ordered');
  return rows;
}
export function cexMid(e: Pick<Evidence, 'cex'>) {
  const mexc = e.cex.find((c) => c.venue === 'mexc'),
    gate = e.cex.find((c) => c.venue === 'gate');
  return mexc && gate
    ? (mexc.bid + mexc.ask + gate.bid + gate.ask) / 4
    : undefined;
}
export const basisPct = (dex: number, cex: number) => (dex / cex - 1) * 100;
/** Matches engine.ts: bandBps gates portfolio weight, NOT the DEX/CEX basis. */
export const insideEngineBand = (
  weight: number,
  target: number,
  bandBps: number,
) => Math.abs(weight - target) * 10000 <= bandBps;
export function evidenceRows(history: Evidence[]) {
  return history
    .flatMap((e) => {
      const cex = cexMid(e);
      return e.dexMid && cex
        ? [{ time: e.now, dex: e.dexMid, cex, basis: basisPct(e.dexMid, cex) }]
        : [];
    })
    .sort((a, b) => a.time - b.time);
}
const symbols: Record<
  string,
  {
    symbol: string;
    color: string;
    shape: 'arrowUp' | 'square' | 'arrowDown' | 'circle';
  }
> = {
  TRADE: { symbol: '▲', color: '#47a878', shape: 'arrowUp' },
  RESIZE: { symbol: '◆', color: '#c38924', shape: 'square' },
  REJECT: { symbol: '✕', color: '#cd5353', shape: 'arrowDown' },
  WAIT: { symbol: '○', color: '#8b9199', shape: 'circle' },
};
export function decisionMarkers(actions: ActionView[]) {
  return [...actions]
    .sort((a, b) => a.at - b.at)
    .map((a, i) => ({
      time: a.at,
      position: 'aboveBar' as const,
      shape: (symbols[a.final.kind] ?? symbols.REJECT).shape,
      color: (symbols[a.final.kind] ?? symbols.REJECT).color,
      text: `${(symbols[a.final.kind] ?? symbols.REJECT).symbol} ${a.final.kind}`,
      id: String(i),
      href: a.txHash
        ? `#/verify?tx=${encodeURIComponent(a.txHash)}`
        : a.receiptHash
          ? `#/verify?receipt=${encodeURIComponent(a.receiptHash)}`
          : undefined,
    }));
}
export function utilisation(used: number | undefined, cap: number) {
  const ratio = used === undefined || cap <= 0 ? undefined : used / cap;
  return {
    used,
    cap,
    ratio,
    remaining: used === undefined ? undefined : Math.max(0, cap - used),
    tone:
      ratio === undefined
        ? 'unknown'
        : ratio >= 1
          ? 'danger'
          : ratio >= 0.8
            ? 'warning'
            : 'ok',
  };
}
export function exposure(
  balanceA: bigint,
  balanceB: bigint,
  decimalsA: number,
  decimalsB: number,
  price: number,
) {
  const a =
    (balanceA * units(price, 18) * 10n ** BigInt(decimalsB)) /
    (10n ** BigInt(decimalsA) * 10n ** 18n);
  const total = a + balanceB;
  return total > 0n ? (Number(a) / Number(total)) * 10000 : undefined;
}
export const istDay = (at: number) =>
  new Date((at + 19800) * 1000).toISOString().slice(0, 10);
export function spendByDay(rows: { at: number; usd: number }[], now: number) {
  const days = Array.from({ length: 7 }, (_, i) => ({
    day: istDay(now - (6 - i) * 86400),
    usd: 0,
  }));
  for (const r of rows) {
    const day = days.find((d) => d.day === istDay(r.at));
    if (day) day.usd += r.usd;
  }
  return days;
}
export function vaultSeries(results: Verification[]) {
  return results.map((r, i) => {
    const p = pnl(results.slice(0, i + 1));
    return {
      time: Number(r.receipt!.evidence.now),
      vault: p.portfolioUSD - p.gasUSD,
      hold: p.holdUSD,
    };
  });
}

/** Extra pinned public reads run alongside the existing resource poll, never a signer. */
export async function readChartRisk(
  client: Pick<import('viem').PublicClient, 'readContract' | 'getBlock'>,
  vault: import('viem').Address,
  blockNumber: bigint,
  decimalsB: number,
) {
  const { vaultAbi } =
    await import('../../../../packages/core/src/abi/index.js');
  const [last, spent, bucket, high, block] = await Promise.all([
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'lastTradeAt',
      blockNumber,
    }),
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'dailyNotionalB',
      blockNumber,
    }),
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'dailyBucket',
      blockNumber,
    }),
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'highWaterMark',
      blockNumber,
    }),
    client.getBlock({ blockNumber }),
  ]);
  return {
    at: Number(block.timestamp),
    lastTradeAt: Number(last),
    dailySpentB:
      Number(BigInt(bucket) === block.timestamp / 86400n ? spent : 0n) /
      10 ** decimalsB,
    highWaterB: Number(high) / 10 ** decimalsB,
  };
}
