import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zeroHash } from 'viem';
import {
  memoryStore,
  jsonFileStore,
  configFromEnv,
  createAgentPolicy,
  createJournal,
} from '../../core/src/agent/index.js';
import { feedServer } from '../src/agent-feed.js';
import { startAgentService } from '../src/agent-service.js';
import {
  agentLock,
  exportSnapshot,
  storageReady,
} from '../src/agent-storage.js';
import type { AgentFeed } from '../src/agent-feed-types.js';
const feed: AgentFeed = {
  state: {
    mode: 'live',
    state: 'offline',
    provider: 'openrouter',
    models: { strategist: '', fitter: '' },
    lastWakeAt: null,
    nextWakeAt: null,
    wakesToday: 0,
    llmCallsToday: 0,
    spendTodayUsd: 0,
    budgetUsd: 1,
    journalHead: null,
    policyHashOk: false,
  },
  watches: [],
  history: [],
  actions: [],
  stats: { calls24h: 0, estimatedSpendUsd: 0, averageLatencyMs: 0 },
};
async function server() {
  const store = memoryStore(),
    journal = await createJournal(store);
  await journal.append('STATE', { state: 'OFFLINE' }, 1);
  const server = feedServer({
    store,
    origins: ['https://dashboard.example'],
    snapshot: async () => ({ feed, entries: journal.entries }),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    store,
    journal,
    close: () =>
      new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r()))),
  };
}
describe('read-only agent feed', () => {
  it('enforces CORS, methods, cursors, route allowlist and artifact names', async () => {
    const s = await server();
    try {
      expect((await fetch(s.base + '/feed/state')).status).toBe(200);
      expect(await (await fetch(s.base + '/feed/state')).json()).toEqual(
        feed.state,
      );
      expect(
        (
          await fetch(s.base + '/feed/state', {
            headers: { Origin: 'https://bad.example' },
          })
        ).status,
      ).toBe(403);
      const allowed = await fetch(s.base + '/healthz', {
        headers: { Origin: 'https://dashboard.example' },
      });
      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://dashboard.example',
      );
      expect(
        (await fetch(s.base + '/feed/state', { method: 'POST' })).status,
      ).toBe(405);
      expect(
        (await fetch(s.base + '/feed/journal?after=' + zeroHash)).status,
      ).toBe(400);
      expect((await fetch(s.base + '/feed/actions?limit=oops')).status).toBe(
        400,
      );
      expect((await fetch(s.base + '/feed/runtime.json')).status).toBe(404);
      expect((await fetch(s.base + '/feed/prompts/not-a-hash')).status).toBe(
        404,
      );
      const journal = await (await fetch(s.base + '/feed/journal')).json();
      expect(journal).toEqual(s.journal.entries);
    } finally {
      await s.close();
    }
  });
  it('limits socket peers to ten requests per second despite spoofed forwarded IPs', async () => {
    const s = await server();
    try {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          fetch(s.base + '/healthz', {
            headers: { 'X-Forwarded-For': String(i) },
          }),
        ),
      );
      expect(results.some((r) => r.status === 429)).toBe(true);
    } finally {
      await s.close();
    }
  });
});
describe('durable service lifecycle', () => {
  it('uses exactly the dashboard source-of-truth feed types', async () => {
    expect(
      await readFile(
        new URL('../src/agent-feed-types.ts', import.meta.url),
        'utf8',
      ),
    ).toBe(
      await readFile(
        new URL(
          '../../../apps/dashboard/src/agent/feed-types.ts',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  });
  it('requires a persistent volume or explicit ephemeral opt-in and excludes secrets from export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-'));
    try {
      await expect(storageReady(root, false)).rejects.toThrow(
        'Persistent volume',
      );
      await storageReady(root, true);
      const release = await agentLock(root);
      await expect(agentLock(root)).rejects.toThrow('writer');
      await release();
      const store = jsonFileStore(root);
      const journal = await createJournal(store);
      await journal.append('STATE', { state: 'OFFLINE' }, 1);
      await store.write('secret.json', { secret: 'must never export' });
      await store.write('pending.json', { receiptHash: zeroHash });
      await expect(exportSnapshot(root, root + '-out')).rejects.toThrow(
        'Unresolved',
      );
      await store.write('pending.json', null);
      await exportSnapshot(root, root + '-out');
      await expect(
        readFile(join(root + '-out', 'secret.json')),
      ).rejects.toThrow();
      expect(await readFile(join(root + '-out', 'journal.jsonl'), 'utf8')).toBe(
        await store.text('journal.jsonl'),
      );
      await rm(root + '-out', { recursive: true, force: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('serves OFFLINE without a key and does not leak environment values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-'));
    const config = configFromEnv('', { STRATEGIST_MODEL: 'mock/strategy' });
    config.policyFile = createAgentPolicy(config);
    const service = await startAgentService({
      exec: 'anvil',
      once: true,
      config,
      env: {
        KEEPER_STATE_DIR: root,
        AGENT_ALLOW_EPHEMERAL: '1',
        AGENT_FEED_PORT: '0',
        OPENROUTER_API_KEY: 'secret-sentinel',
      },
    });
    try {
      await service.done;
      const s = await service.snapshot();
      expect(s.feed.state.state).toBe('offline');
      expect(JSON.stringify(s)).not.toContain('secret-sentinel');
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('unwritable or ephemeral storage reports OFFLINE without initializing clients', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-')),
      readState = vi.fn();
    const service = await startAgentService({
      exec: 'anvil',
      once: true,
      env: { KEEPER_STATE_DIR: root, AGENT_FEED_PORT: '0' },
      clients: { readState } as never,
    });
    try {
      await service.done;
      expect((await service.snapshot()).feed.state.state).toBe('offline');
      expect(readState).not.toHaveBeenCalled();
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('recovers a dead local process lock but refuses malformed locks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-'));
    try {
      await writeFile(join(root, '.service.lock'), '2147483647');
      const release = await agentLock(root);
      await release();
      await writeFile(join(root, '.service.lock'), 'bad');
      await expect(agentLock(root)).rejects.toThrow('Invalid');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
