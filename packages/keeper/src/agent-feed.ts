import { journalSpendByDay } from './feed.js';
import { createServer } from 'node:http';
import type {
  Store,
  JournalEntry,
  WatchState,
  Watch,
  ReceiptV3,
} from '../../core/src/agent/index.js';
import type { AgentFeed, AgentState, ActionView } from './agent-feed-types.js';
import type { OwnerReceipt } from '../../core/src/agent/owner-receipt.js';
export type { AgentFeed, AgentState } from './agent-feed-types.js';
export const json = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) =>
    typeof v === 'bigint' ? String(v) : v,
  );
const label = (w: Watch) => `${w.kind.type}: ${w.note}`;
/** Projection only: never exposes process configuration, pending intents or signer material. */
export async function projectFeed(
  store: Store,
  state: AgentState,
  entries: JournalEntry[],
  now: number,
): Promise<AgentFeed> {
  const saved = await store.read<WatchState>('watches.json');
  const calls = entries.filter(
    (e) => e.type === 'LLM_CALL' && e.at > now - 86400,
  );
  const actions: ActionView[] = [];
  let wake: JournalEntry[] = [];
  for (const e of entries) {
    if (e.type === 'WAKE') wake = [];
    wake.push(e);
    if (e.type !== 'ACTION') continue;
    const r = e.data.receiptHash
      ? await store.read<ReceiptV3 | OwnerReceipt>(
          `receipts/${e.data.receiptHash}.json`,
        )
      : undefined;
    actions.push({
      at: e.at,
      intent: {
        type: r?.intent.type ?? 'HOLD',
        notionalB: Number(r?.intent.notionalB ?? 0),
      },
      final: {
        kind: String(e.data.kind),
        ...(r ? { direction: r.final.direction } : {}),
        amountIn: String(e.data.amountIn ?? 0),
        minOut: String(e.data.minOut ?? 0),
      },
      trail: r?.fit.trail ?? String(e.data.reason ?? ''),
      rounds: (r?.version === 4 ? [] : wake)
        .filter((e) => e.type === 'LLM_CALL')
        .map((e) => ({
          role: String(e.data.role),
          round: Number(e.data.round),
          summary: e.data.parsedOk
            ? 'Validated response recorded'
            : 'Response rejected',
          outputHash: String(e.data.outputHash),
        })),
      violations: (r?.version === 4 ? [] : wake)
        .filter((e) => e.type === 'MANDATE_CHECK')
        .flatMap((e) => (e.data.violations ?? []) as ActionView['violations']),
      ...(e.data.txHash ? { txHash: String(e.data.txHash) } : {}),
      ...(r ? { receiptHash: r.receiptHash } : {}),
    });
  }
  return {
    state,
    spendByDay: journalSpendByDay(entries, now),
    watches: (saved?.watches ?? [])
      .filter(
        (w) =>
          (w.expiresAt === undefined || w.expiresAt > now) &&
          !(
            ['retry', 'time'].includes(w.kind.type) &&
            'at' in w.kind &&
            w.fireCount > 0
          ),
      )
      .map((w) => ({
        ...w,
        kind: w.kind.type,
        label: label(w),
        createdBy: w.createdBy === 'system' ? 'system' : 'agent',
      })),
    history: entries
      .filter((e) => e.type === 'WATCH_CHANGE')
      .map((e) => {
        const d = e.data,
          w = (d.after ?? d.before) as Watch | undefined;
        return {
          at: e.at,
          op: d.op === 'update' ? 'edit' : (d.op as 'create' | 'delete'),
          by: d.by === 'system' ? 'system' : 'agent',
          watchId: String(d.watchId),
          label: w ? label(w) : String(d.watchId),
          reason: String(d.reason),
          accepted: d.accepted === true,
          ...(d.rejectReason ? { rejectReason: String(d.rejectReason) } : {}),
        };
      }),
    actions: actions.reverse(),
    stats: {
      calls24h: calls.length,
      estimatedSpendUsd: calls.reduce(
        (n, e) => n + Number(e.data.costUsdEst ?? 0),
        0,
      ),
      averageLatencyMs: calls.length
        ? calls.reduce((n, e) => n + Number(e.data.latencyMs ?? 0), 0) /
          calls.length
        : 0,
    },
  };
}
export function feedServer(options: {
  snapshot(): Promise<{ feed: AgentFeed; entries: JournalEntry[] }>;
  store: Store;
  origins: string[];
  status?(): { reason: string; ephemeral: boolean; state: string };
}) {
  const rates = new Map<string, { second: number; count: number }>();
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const reply = (code: number, body: unknown) => {
      res.writeHead(code);
      res.end(json(body));
    };
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return reply(405, { error: 'GET only' });
    }
    const origin = req.headers.origin;
    if (origin && !options.origins.includes(origin))
      return reply(403, { error: 'Origin denied' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    // Socket peer only. Forwarded headers are untrusted and cannot bypass the cap.
    const ip = req.socket.remoteAddress ?? 'unknown',
      second = Math.floor(Date.now() / 1000);
    for (const [key, row] of rates)
      if (row.second !== second) rates.delete(key);
    const rate = rates.get(ip) ?? { second, count: 0 };
    rates.set(ip, rate);
    if (++rate.count > 10) {
      res.setHeader('Retry-After', '1');
      return reply(429, { error: 'Rate limit' });
    }
    try {
      const u = new URL(req.url ?? '/', 'http://localhost');
      const limit = (fallback: number, max: number) => {
        const raw = u.searchParams.get('limit');
        if (raw !== null && !/^[1-9]\d*$/.test(raw))
          throw Error('Invalid limit');
        return Math.min(Number(raw ?? fallback), max);
      };
      if (u.pathname === '/healthz')
        return reply(200, { ok: true, ...options.status?.() });
      if (
        /^\/feed\/(prompts|evidence|states|receipts)\/0x[\da-f]{64}$/i.test(
          u.pathname,
        )
      ) {
        const key = u.pathname.slice(6) + '.json';
        const raw = await options.store.text(key);
        return raw
          ? reply(200, JSON.parse(raw))
          : reply(404, { error: 'Artifact unavailable' });
      }
      if (u.pathname === '/feed/policy') {
        const policy = await options.store.text('policy.json');
        return policy
          ? reply(200, { text: policy })
          : reply(404, { error: 'Policy unavailable' });
      }
      const { feed, entries } = await options.snapshot();
      if (u.pathname === '/feed/state') return reply(200, feed.state);
      if (u.pathname === '/feed/stats')
        return reply(200, { stats: feed.stats, spendByDay: feed.spendByDay });
      if (u.pathname === '/feed/watches')
        return reply(200, { active: feed.watches, history: feed.history });
      if (u.pathname === '/feed/actions')
        return reply(200, feed.actions.slice(0, limit(50, 200)));
      if (u.pathname === '/feed/journal') {
        const after = u.searchParams.get('after');
        const index = after
          ? entries.findIndex((e) => e.entryHash === after)
          : -1;
        if (after && index < 0)
          return reply(400, { error: 'Unknown journal cursor' });
        return reply(
          200,
          entries.slice(index + 1, index + 1 + limit(200, 200)),
        );
      }
      return reply(404, { error: 'Route unavailable' });
    } catch {
      return reply(400, { error: 'Feed unavailable or invalid request' });
    }
  });
}
