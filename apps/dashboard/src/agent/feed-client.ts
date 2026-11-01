import { z } from 'zod';
import type { AgentFeed } from './feed-types.js';
const finite = z.number().finite(),
  time = finite.nonnegative(),
  nullable = time.nullable();
export const stateSchema = z.object({
  executionChainId: z
    .union([z.literal(133), z.literal(177), z.literal(31337)])
    .optional(),
  mode: z.enum(['live', 'demo']),
  state: z.enum(['online', 'offline', 'budget_paused', 'needs_owner']),
  provider: z.string(),
  models: z.object({ strategist: z.string(), fitter: z.string() }),
  lastWakeAt: nullable,
  nextWakeAt: nullable,
  wakesToday: time,
  llmCallsToday: time,
  spendTodayUsd: time,
  budgetUsd: time,
  journalHead: z.string().nullable(),
  policyHashOk: z.boolean(),
});
const watch = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  createdBy: z.enum(['agent', 'system']),
  note: z.string(),
  createdAt: time,
  expiresAt: time.optional(),
  lastFiredAt: time.optional(),
  fireCount: time,
});
const history = z.object({
  at: time,
  op: z.enum(['create', 'edit', 'delete']),
  by: z.enum(['agent', 'system']),
  watchId: z.string(),
  label: z.string(),
  reason: z.string(),
  accepted: z.boolean(),
  rejectReason: z.string().optional(),
});
const action = z.object({
  at: time,
  intent: z.object({ type: z.string(), notionalB: finite }),
  final: z.object({
    kind: z.string(),
    direction: z.string().optional(),
    amountIn: z.string().optional(),
    minOut: z.string().optional(),
  }),
  trail: z.string(),
  rounds: z.array(
    z.object({
      role: z.string(),
      round: time,
      summary: z.string(),
      outputHash: z.string().nullable(),
    }),
  ),
  violations: z.array(
    z.object({ limit: z.string(), required: z.string(), allowed: z.string() }),
  ),
  txHash: z.string().optional(),
  receiptHash: z.string().optional(),
});
export const statsSchema = z.object({
  calls24h: time,
  estimatedSpendUsd: time,
  averageLatencyMs: time,
});
export const spendSchema = z.array(
  z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), usd: time }),
);
export const feedSchema = z.object({
  spendByDay: spendSchema.optional(),
  state: stateSchema,
  watches: z.array(watch),
  history: z.array(history),
  actions: z.array(action),
  stats: z.object({
    calls24h: time,
    estimatedSpendUsd: time,
    averageLatencyMs: time,
  }),
});
export async function readFeedJSON(
  base: string,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const r = await fetch(base.replace(/\/$/, '') + path, {
    signal: signal ?? AbortSignal.timeout(8000),
  });
  if (!r.ok) throw Error('Feed unreachable');
  return r.json();
}
export async function fetchFeed(
  base: string,
  signal?: AbortSignal,
): Promise<AgentFeed> {
  // Sequential requests stay below the shared 10 rps/IP feed cap, including Verify.
  const state = stateSchema.parse(
    await readFeedJSON(base, '/feed/state', signal),
  );
  if (
    import.meta.env.VITE_EXECUTION_CHAIN === '177' &&
    state.executionChainId !== 177
  )
    throw Error('Agent execution chain mismatch');
  const w = z
    .object({ active: z.array(watch), history: z.array(history) })
    .parse(await readFeedJSON(base, '/feed/watches', signal));
  const actions = z
    .array(action)
    .parse(await readFeedJSON(base, '/feed/actions?limit=50', signal));
  const summary = z
    .object({ stats: statsSchema, spendByDay: spendSchema.optional() })
    .parse(await readFeedJSON(base, '/feed/stats', signal));
  return {
    ...summary,
    state,
    watches: w.active,
    history: w.history,
    actions,
  };
}
export const fallbackMessage =
  'Agent feed unreachable — showing on-chain receipts and the last exported snapshot';
export const snapshotBase = `/receipts/${import.meta.env.VITE_EXECUTION_CHAIN === '177' ? 177 : 133}/agent`;
