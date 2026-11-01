import { watchSchema, type Watch, type WatchChanges } from './schema.js';
import type { Store } from './store.js';
export const defaultWatchBounds = {
  maxActive: 8,
  minCooldownSec: 60,
  minEverySec: 300,
  maxEverySec: 86400,
  minPct: 0.2,
  maxPct: 50,
  maxExpirySec: 7 * 86400,
  maxChangesPerHour: 20,
};
export type WatchBounds = typeof defaultWatchBounds;
export type WatchState = { watches: Watch[]; changes: number[] };
export type WatchChange = {
  op: 'create' | 'update' | 'delete';
  by: 'strategist' | 'system';
  watchId: string;
  before?: Watch;
  after?: Watch;
  reason: string;
  accepted: boolean;
  rejectReason?: string;
};
export function boundReason(
  w: Watch,
  now: number,
  b: WatchBounds,
): string | undefined {
  if (w.createdBy === 'system') return;
  if (
    w.id === 'heartbeat' ||
    w.kind.type === 'retry' ||
    w.id.startsWith('owner:') ||
    w.id.startsWith('retry:')
  )
    return 'reserved system watch';
  if (w.cooldownSec < b.minCooldownSec) return 'cooldownSec below minimum';
  if (
    w.expiresAt !== undefined &&
    (w.expiresAt <= now || w.expiresAt > now + b.maxExpirySec)
  )
    return 'expiresAt outside bounds';
  if (
    w.kind.type === 'time' &&
    w.kind.everySec !== undefined &&
    (w.kind.everySec < b.minEverySec || w.kind.everySec > b.maxEverySec)
  )
    return 'everySec outside bounds';
  if ('pct' in w.kind && (w.kind.pct < b.minPct || w.kind.pct > b.maxPct))
    return 'pct outside bounds';
}
export function applyWatchChanges(
  state: WatchState,
  changes: WatchChanges,
  now: number,
  b: WatchBounds = defaultWatchBounds,
): { state: WatchState; events: WatchChange[] } {
  let watches = state.watches.filter(
    (w) => w.expiresAt === undefined || w.expiresAt > now,
  );
  const times = state.changes.filter((t) => t > now - 3600),
    events: WatchChange[] = [];
  const operations = [
    ...changes.create.map((d) => ({
      op: 'create' as const,
      id: d.id,
      draft: d,
      reason: d.note,
    })),
    ...changes.update.map((u) => ({ op: 'update' as const, ...u })),
    ...changes.delete.map((d) => ({ op: 'delete' as const, ...d })),
  ];
  for (const o of operations) {
    const before = watches.find((w) => w.id === o.id);
    let reason: string | undefined, after: Watch | undefined;
    if (times.length >= b.maxChangesPerHour)
      reason = 'watch change rate exceeded';
    else if (o.op === 'create' && before) reason = 'watch already exists';
    else if (o.op !== 'create' && !before) reason = 'unknown watch';
    else if (before?.createdBy === 'system')
      reason = 'system watch is protected';
    if (o.op !== 'delete') {
      const parsed = watchSchema.safeParse(
        o.op === 'create'
          ? {
              ...o.draft,
              createdBy: 'strategist',
              createdAt: now,
              fireCount: 0,
            }
          : { ...before, ...o.patch },
      );
      if (!parsed.success) reason ??= 'invalid watch schema';
      else {
        after = parsed.data;
        reason ??= boundReason(after, now, b);
      }
      if (
        o.op === 'create' &&
        watches.filter((w) => w.createdBy === 'strategist').length >=
          b.maxActive
      )
        reason ??= 'too many active watches';
    }
    // Rejected attempts count too, preventing unbounded rejected-change floods.
    times.push(now);
    const event: WatchChange = {
      op: o.op,
      by: 'strategist',
      watchId: o.id,
      reason: o.reason,
      accepted: !reason,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      ...(reason ? { rejectReason: reason } : {}),
    };
    events.push(event);
    if (!reason) {
      watches = watches.filter((w) => w.id !== o.id);
      if (after) watches.push(after);
    }
  }
  return { state: { watches, changes: times }, events };
}
export async function loadWatches(
  store: Store,
  now: number,
  heartbeatSec = 3600,
): Promise<WatchState> {
  const saved = (await store.read<WatchState>('watches.json')) ?? {
    watches: [],
    changes: [],
  };
  saved.watches = saved.watches.map((w) => watchSchema.parse(w));
  if (!saved.watches.some((w) => w.id === 'heartbeat'))
    saved.watches.push({
      id: 'heartbeat',
      kind: { type: 'time', everySec: heartbeatSec },
      note: 'System check-in',
      createdBy: 'system',
      createdAt: now,
      cooldownSec: 60,
      fireCount: 0,
    });
  return saved;
}
