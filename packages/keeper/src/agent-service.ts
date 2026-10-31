import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createAgent,
  configFromEnv,
  openRouter,
  jsonFileStore,
  createJournal,
  validateAgentPolicy,
  type AgentClients,
  type Provider,
  type JournalEntry,
  type AgentConfig,
} from '../../core/src/agent/index.js';
import { feedServer, projectFeed, type AgentState } from './agent-feed.js';
import { storageReady, agentLock, exportSnapshot } from './agent-storage.js';
import { connectAgentRpc, PreflightError } from './agent-rpc.js';
import { repositoryRoot } from './config.js';
type Env = Record<string, string | undefined>;
export function stateRoot(env: Env = process.env) {
  return resolve(
    env.KEEPER_STATE_DIR ??
      (env.AGENT_DATA_DIR
        ? join(env.AGENT_DATA_DIR, 'agent')
        : './.agent-state'),
  );
}
export async function startAgentService(options: {
  exec: 'testnet' | 'anvil';
  once?: boolean;
  env?: Env;
  // Test injection keeps all hosted providers and real networks outside tests.
  clients?: AgentClients;
  provider?: Provider;
  config?: AgentConfig;
}) {
  const env = options.env ?? process.env,
    root = stateRoot(env),
    store = jsonFileStore(root);
  const chain = options.exec === 'testnet' ? 133 : 31337;
  let reason = 'Starting preflight',
    forced: AgentState['state'] | undefined = 'offline',
    policyHashOk = false;
  let storageOk = false,
    release: (() => Promise<void>) | undefined;
  try {
    await storageReady(
      env.AGENT_DATA_DIR ?? root,
      env.AGENT_ALLOW_EPHEMERAL === '1',
    );
    release = await agentLock(root);
    storageOk = true;
  } catch {
    reason =
      'AGENT_DATA_DIR must be writable and persistent (or AGENT_ALLOW_EPHEMERAL=1)';
  }
  let agent: Awaited<ReturnType<typeof createAgent>> | undefined;
  let config: AgentConfig | undefined = options.config;
  let entries: JournalEntry[] = [];
  const snapshot = async () => {
    const now = Math.floor(Date.now() / 1000),
      runtime = storageOk
        ? await store.read<{
            budget?: {
              wakes: number[];
              costs: { at: number; usd: number }[];
              lastWake?: number;
            };
            state?: string;
          }>('runtime.json')
        : undefined;
    const today = now - (now % 86400);
    const calls = entries.filter((e) => e.type === 'LLM_CALL' && e.at >= today);
    const budget = runtime?.budget;
    const state: AgentState = {
      mode: 'live',
      state:
        forced ??
        (
          {
            ONLINE: 'online',
            OFFLINE: 'offline',
            NEEDS_OWNER: 'needs_owner',
            BUDGET_PAUSED: 'budget_paused',
          } as const
        )[runtime?.state as 'ONLINE'] ??
        'online',
      provider: 'openrouter',
      models: config?.models ?? {
        strategist: env.STRATEGIST_MODEL ?? '',
        fitter: env.FITTER_MODEL || env.STRATEGIST_MODEL || '',
      },
      lastWakeAt: budget?.lastWake ?? null,
      nextWakeAt: budget?.lastWake
        ? budget.lastWake + (config?.heartbeatSec ?? 3600)
        : null,
      wakesToday: budget?.wakes.filter((t) => t >= today).length ?? 0,
      llmCallsToday: calls.length,
      spendTodayUsd:
        budget?.costs
          .filter((c) => c.at >= today)
          .reduce((n, c) => n + c.usd, 0) ?? 0,
      budgetUsd: config?.dailyLlmBudgetUsd ?? 1,
      journalHead: entries.at(-1)?.entryHash ?? null,
      policyHashOk,
    };
    return {
      feed: storageOk
        ? await projectFeed(store, state, entries, now)
        : {
            state,
            watches: [],
            history: [],
            actions: [],
            stats: { calls24h: 0, estimatedSpendUsd: 0, averageLatencyMs: 0 },
          },
      entries: [...entries],
    };
  };
  const server = feedServer({
    store,
    snapshot,
    status: () => ({
      reason,
      ephemeral: env.AGENT_ALLOW_EPHEMERAL === '1',
      state: forced ?? 'ready',
    }),
    origins: (env.AGENT_FEED_ORIGINS ?? env.AGENT_FEED_CORS_ORIGIN ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  const port = Number(env.PORT ?? env.AGENT_FEED_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    await release?.();
    throw Error('Invalid feed port');
  }
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', fail);
      ok();
    });
  });
  let stopped = false,
    active = Promise.resolve();
  const abort = new AbortController();
  const stop = () => {
    stopped = true;
    abort.abort();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const cycle = async () => {
    if (!storageOk) return;
    try {
      if (!config)
        config = configFromEnv(
          await readFile(
            env.AGENT_POLICY_FILE ??
              join(repositoryRoot(), 'policy/agent-v3.json'),
            'utf8',
          ),
          env,
        );
      const provider =
        options.provider ??
        openRouter({
          ...env,
          AGENT_OPENROUTER_API_KEY:
            env.OPENROUTER_API_KEY ?? env.AGENT_OPENROUTER_API_KEY,
        });
      if (!agent) {
        validateAgentPolicy(config);
        const journal = await createJournal(store);
        entries = journal.entries;
        const rpc = options.clients
          ? {
              clients: options.clients,
              reconcile: async () => {
                if (await store.read('pending.json'))
                  throw new PreflightError(
                    'needs_owner',
                    'Unresolved injected pending intent',
                  );
              },
            }
          : await connectAgentRpc(options.exec, store, env);
        await rpc.reconcile(journal);
        const live = await rpc.clients.readState();
        policyHashOk = live.mandate.policyHash === validateAgentPolicy(config);
        if (
          !policyHashOk ||
          live.paused ||
          live.revoked ||
          live.mandate.expiry <= BigInt(live.blockTime) ||
          live.mandate.agent.toLowerCase() !== live.agent.toLowerCase()
        )
          throw new PreflightError(
            'needs_owner',
            'Mandate/policy requires owner',
          );
        agent = await createAgent({
          provider,
          store,
          clients: rpc.clients,
          config,
        });
        entries = agent.journal.entries;
        // Recheck owner authorization on every poll, not only on model wakes.
        readState = rpc.clients.readState;
      }
      if (!provider.isConfigured())
        throw new PreflightError(
          'offline',
          'OPENROUTER_API_KEY or STRATEGIST_MODEL missing',
        );
      const live = await readState!();
      policyHashOk = live.mandate.policyHash === validateAgentPolicy(config);
      if (
        !policyHashOk ||
        live.paused ||
        live.revoked ||
        live.mandate.expiry <= BigInt(live.blockTime) ||
        live.mandate.agent.toLowerCase() !== live.agent.toLowerCase()
      )
        throw new PreflightError(
          'needs_owner',
          'Mandate/policy requires owner',
        );
      forced = undefined;
      reason = '';
      // T12 tick evaluates watches and internally invokes wake for the merged fired set.
      await agent.tick(Math.floor(Date.now() / 1000));
      await store.write(
        '.pending.json',
        (await store.read('pending.json'))
          ? ((await store.read('.pending.json')) ?? null)
          : null,
      );
    } catch (e) {
      forced = e instanceof PreflightError ? e.state : 'offline';
      reason =
        e instanceof PreflightError
          ? e.reason
          : 'Preflight or wake failed; inspect policy, RPC, volume and pending intent';
      // Never emit arbitrary RPC/provider errors: they can contain credential-bearing URLs.
    }
    if (storageOk) {
      const { feed } = await snapshot();
      await store.write('feed.json', feed);
      await store.write('service-status.json', {
        state: forced ?? feed.state.state,
        reason,
        ephemeral: env.AGENT_ALLOW_EPHEMERAL === '1',
        chain,
      });
    }
  };
  let readState: AgentClients['readState'] | undefined;
  const run = async () => {
    do {
      active = cycle();
      await active;
      if (stopped || options.once) break;
      try {
        await delay((config?.pollSec ?? 20) * 1000, undefined, {
          signal: abort.signal,
        });
      } catch {
        /* stop interrupts poll delay */
      }
    } while (!stopped);
  };
  const done = run();
  const close = async () => {
    stop();
    await done;
    await active;
    await new Promise<void>((ok, fail) =>
      server.close((e) => (e ? fail(e) : ok())),
    );
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await release?.();
  };
  return {
    server,
    store,
    root,
    snapshot,
    done,
    close,
    get reason() {
      return reason;
    },
  };
}
export async function agentCommand(argv: string[]) {
  const args = [...argv];
  let exec: 'testnet' | 'anvil' | undefined,
    once = false;
  while (args.length) {
    const a = args.shift();
    if (a === '--once') once = true;
    else if (a === '--exec') {
      const v = args.shift();
      if (v !== 'testnet' && v !== 'anvil')
        throw Error('agent --exec testnet|anvil');
      exec = v;
    } else throw Error('Unknown agent option');
  }
  if (!exec) throw Error('agent --exec testnet|anvil [--once]');
  const service = await startAgentService({ exec, once });
  try {
    await service.done;
  } finally {
    await service.close();
  }
}
export async function exportAgentCommand(argv: string[]) {
  if (
    argv.length !== 2 ||
    argv[0] !== '--chain' ||
    !['133', '31337'].includes(argv[1])
  )
    throw Error('export-agent --chain 133|31337');
  const root = stateRoot(),
    release = await agentLock(root);
  try {
    await exportSnapshot(
      root,
      join(repositoryRoot(), 'receipts', argv[1], 'agent'),
    );
  } finally {
    await release();
  }
}
