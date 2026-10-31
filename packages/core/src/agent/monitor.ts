import type { Watch } from './schema.js';
export type EvidenceLite = {
  prices: Partial<Record<'dex' | 'cex' | 'apro', string>>;
  liquidity?: string;
  swaps?: { at: number; usd: number }[];
  ownerEvents?: {
    id: string;
    name: 'MandateSet' | 'Paused' | 'Unpaused' | 'Revoked';
    block: number;
  }[];
};
export type FiredWatch = { watch: Watch; why: string };
/** Pure evaluation. Caller persists lastFiredAt/fireCount only for an admitted wake. */
export function evaluate(
  watches: Watch[],
  e: EvidenceLite,
  now: number,
): FiredWatch[] {
  return watches.flatMap((w) => {
    if (
      (w.expiresAt !== undefined && now >= w.expiresAt) ||
      (w.lastFiredAt !== undefined && now < w.lastFiredAt + w.cooldownSec)
    )
      return [];
    const k = w.kind;
    let fire = false;
    const price = 'source' in k ? Number(e.prices[k.source]) : NaN;
    if (k.type === 'price_move_pct' && price > 0 && Number.isFinite(price)) {
      const move = (price / Number(k.refPrice) - 1) * 100;
      fire =
        k.dir === 'up'
          ? move >= k.pct
          : k.dir === 'down'
            ? move <= -k.pct
            : Math.abs(move) >= k.pct;
    }
    if (k.type === 'price_cross' && price > 0 && Number.isFinite(price))
      fire =
        k.dir === 'above' ? price > Number(k.level) : price < Number(k.level);
    if (k.type === 'liquidity_change_pct' && e.liquidity !== undefined)
      fire =
        Math.abs(Number(e.liquidity) / Number(k.refLiquidity) - 1) * 100 >=
        k.pct;
    if (k.type === 'basis_bps') {
      const dex = Number(e.prices.dex),
        cex = Number(e.prices.cex);
      fire =
        dex > 0 &&
        cex > 0 &&
        (Math.abs(dex - cex) / cex) * 10000 >= k.thresholdBps;
    }
    if (k.type === 'swap_activity') {
      const swaps = (e.swaps ?? []).filter(
        (s) => s.at <= now && s.at > now - k.windowMin * 60,
      );
      fire =
        (k.minSwaps === undefined || swaps.length >= k.minSwaps) &&
        (k.minUsd === undefined ||
          swaps.reduce((n, s) => n + s.usd, 0) >= k.minUsd);
    }
    if (k.type === 'time')
      fire =
        k.at !== undefined
          ? now >= k.at && w.fireCount === 0
          : now >= (w.lastFiredAt ?? w.createdAt) + (k.everySec ?? 3600);
    if (k.type === 'retry') fire = now >= k.at && w.fireCount === 0;
    return fire ? [{ watch: w, why: `${k.type} condition satisfied` }] : [];
  });
}
export type Budget = {
  wakes: number[];
  costs: { at: number; usd: number }[];
  lastWake?: number;
};
export function budgetLeft(
  b: Budget,
  now: number,
  maxWakes = 12,
  dailyUsd = 1,
  minGap = 60,
) {
  const wakes = maxWakes - b.wakes.filter((t) => t > now - 3600).length;
  const usd =
    dailyUsd -
    b.costs
      .filter((c) => Math.floor(c.at / 86400) === Math.floor(now / 86400))
      .reduce((n, c) => n + c.usd, 0);
  return {
    wakes,
    usd,
    paused: wakes <= 0 || usd <= 0,
    debounced: b.lastWake !== undefined && now < b.lastWake + minGap,
  };
}
