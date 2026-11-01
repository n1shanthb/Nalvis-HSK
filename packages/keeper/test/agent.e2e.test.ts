import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mnemonicToAccount } from 'viem/accounts';
import { localVault, hasAnvil } from '../../core/test/agent/anvil.js';
import {
  configFromEnv,
  createAgentPolicy,
  agentPolicyHash,
  openRouter,
  jsonFileStore,
  createJournal,
  type Watch,
  type ReceiptV3,
} from '../../core/src/agent/index.js';
import { verify, rpcReader } from '../../verifier/src/verify.js';
import { startAgentService } from '../src/agent-service.js';
import { connectAgentRpc } from '../src/agent-rpc.js';
import { exportSnapshot } from '../src/agent-storage.js';
import { json } from '../src/agent-feed.js';
const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Timed out waiting for service');
};
it.skipIf(!hasAnvil)(
  'anvil service: HTTP models, price watch, fitted leg, SIGTERM drain, export verification and mined-pending recovery',
  async () => {
    const h = await localVault(),
      root = await mkdtemp(join(tmpdir(), 'agent-e2e-'));
    const config = configFromEnv('', {
      STRATEGIST_MODEL: 'mock/strategist',
      FITTER_MODEL: 'mock/fitter',
      AGENT_POLL_SEC: '1',
    });
    config.policyFile = createAgentPolicy(config);
    await h.write(h.vault, 'setMandate', [
      { ...h.mandate, policyHash: agentPolicyHash(config.policyFile) },
    ]);
    const now = Math.floor(Date.now() / 1000),
      store = jsonFileStore(root);
    const watch: Watch = {
      id: 'price',
      kind: {
        type: 'price_move_pct',
        source: 'dex',
        refPrice: '100',
        pct: 2,
        dir: 'up',
      },
      note: 'Watch +2%',
      createdBy: 'strategist',
      createdAt: now,
      cooldownSec: 60,
      fireCount: 0,
    };
    let price = '100',
      responses = 0;
    const mock = createServer(async (req, res) => {
      if (req.url === '/rpc') {
        for await (const chunk of req) void chunk;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xb1' }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      expect(body.provider.require_parameters).toBe(true);
      expect(body.reasoning.effort).toBe('low');
      const input = JSON.parse(body.messages[1].content);
      const output =
        responses++ === 0
          ? {
              thesis: 'Watch first',
              action: { type: 'HOLD', urgency: 'now', reason: 'Observe price' },
              watches: {
                create: [
                  {
                    id: 'price',
                    kind: watch.kind,
                    note: watch.note,
                    cooldownSec: 60,
                  },
                ],
                update: [],
                delete: [],
              },
              confidence: 0.9,
              signals: [],
            }
          : body.model === 'mock/fitter'
            ? {
                proposal: {
                  type: 'BUY',
                  legs: [
                    {
                      notionalB: '100',
                      notBefore: (await h.state()).blockTime,
                    },
                    {
                      notionalB: '100',
                      notBefore: (await h.state()).blockTime + 300,
                    },
                  ],
                  directionChanged: false,
                },
                explanation: 'Two legs across cooldown',
              }
            : input.fitterProposal
              ? { decision: 'accept', reason: 'Accept split' }
              : {
                  thesis: 'Buy after move',
                  action: {
                    type: 'BUY',
                    notionalB: '200',
                    urgency: 'now',
                    reason: 'Price watch fired',
                  },
                  watches: { create: [], update: [], delete: [] },
                  confidence: 0.9,
                  signals: [],
                };
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          model: body.model,
          choices: [{ message: { content: JSON.stringify(output) } }],
          usage: { cost: 0.001, prompt_tokens: 50, completion_tokens: 50 },
        }),
      );
    });
    await new Promise<void>((ok, fail) => {
      mock.once('error', fail);
      mock.listen(0, '127.0.0.1', ok);
    });
    const mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
    const dev = mnemonicToAccount(
      'test test test test test test test test test test test junk',
      { addressIndex: 1 },
    );
    await writeFile(
      join(root, 'deployment.json'),
      json({
        vault: h.vault.address,
        router: h.router.address,
        owner: h.owner,
        agent: h.agent,
        deployer: (await h.wallet.getAddresses())[2],
        block: 0,
        commit: '0'.repeat(40),
      }),
    );
    const env = {
      KEEPER_STATE_DIR: root,
      AGENT_ALLOW_EPHEMERAL: '1',
      AGENT_FEED_PORT: '0',
      ANVIL_RPC: h.url,
      HSK_MAINNET_RPC: mockUrl + '/rpc',
      AGENT_DEPLOYMENT: join(root, 'deployment.json'),
      AGENT_PRIVATE_KEY: dev.getHdKey().privateKey
        ? '0x' + Buffer.from(dev.getHdKey().privateKey!).toString('hex')
        : undefined,
      OPENROUTER_API_KEY: 'test-only-placeholder',
      STRATEGIST_MODEL: 'mock/strategist',
      FITTER_MODEL: 'mock/fitter',
    };
    const provider = openRouter(
      { ...env, AGENT_OPENROUTER_API_KEY: env.OPENROUTER_API_KEY },
      (_url, init) => fetch(mockUrl + '/completion', init),
    );
    let mined: ReceiptV3 | undefined,
      drain: () => void = () => {},
      gated = false,
      gateEnabled = false;
    const connect: typeof connectAgentRpc = async (exec, s, e) => {
      const rpc = await connectAgentRpc(exec, s, e);
      const send = rpc.clients.send;
      rpc.clients.evidenceLite = async () => ({ prices: { dex: price } });
      rpc.clients.collectEvidence = async () => ({
        marketDataChainId: 177,
        executionChainId: 31337,
        dexMid: Number(price),
        note: 'Mock market data for local test only',
      });
      rpc.clients.quote = h.quote;
      rpc.clients.send = async (r) => {
        const result = await send(r);
        mined = r;
        if (gateEnabled) {
          gated = true;
          await new Promise<void>((r) => {
            drain = r;
          });
        }
        return result;
      };
      return rpc;
    };
    let service: Awaited<ReturnType<typeof startAgentService>> | undefined;
    try {
      // Make heartbeat eligible immediately; first model wake creates a real journaled watch.
      const hb: Watch = {
        id: 'heartbeat',
        kind: { type: 'time', everySec: 3600 },
        note: 'System check-in',
        createdBy: 'system',
        createdAt: now - 3601,
        cooldownSec: 60,
        fireCount: 0,
      };
      await store.write('watches.json', { watches: [hb], changes: [] });
      const j = await createJournal(store);
      await j.append(
        'WATCH_CHANGE',
        {
          op: 'create',
          by: 'system',
          watchId: 'heartbeat',
          after: hb,
          reason: hb.note,
          accepted: true,
        },
        now - 3601,
      );
      service = await startAgentService({
        exec: 'anvil',
        env,
        provider,
        config,
        connect,
      });
      await waitFor(async () =>
        Boolean(
          (await service!.snapshot()).feed.watches.find(
            (w) => w.id === 'price',
          ),
        ),
      );
      // Permit a second wake without waiting a minute in wall time; persist via restart.
      await service.close();
      service = undefined;
      const runtime = await store.read<Record<string, unknown>>('runtime.json');
      const budget = runtime!.budget as { lastWake: number };
      budget.lastWake -= 61;
      await store.write('runtime.json', runtime);
      price = '102.1';
      gateEnabled = true;
      service = await startAgentService({
        exec: 'anvil',
        env,
        provider,
        config,
        connect,
      });
      await waitFor(async () => gated);
      process.emit('SIGTERM');
      let finished = false;
      void service.done.then(() => {
        finished = true;
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(finished).toBe(false);
      drain();
      await service.done;
      const feed = (await service.snapshot()).feed;
      expect(feed.actions[0].intent).toEqual({ type: 'BUY', notionalB: 200 });
      expect(feed.actions[0].final.kind).toBe('RESIZE');
      expect(feed.watches.some((w) => w.kind === 'retry')).toBe(true);
      const base = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
      const watches = await (await fetch(base + '/feed/watches')).json();
      expect(
        watches.active.some((w: { kind: string }) => w.kind === 'retry'),
      ).toBe(true);
      await service.close();
      service = undefined;
      const count = await h.client.getTransactionCount({ address: h.agent });
      const last = mined!;
      // Emulate crash after mining but before ACTION/runtime/pending finalization.
      await store.write('pending.json', {
        receiptHash: last.receiptHash,
        seq: last.seq,
        prevHead: last.prevHead,
      });
      await store.write('.pending.json', {
        receiptHash: last.receiptHash,
        transactionHash: feed.actions[0].txHash,
      });
      service = await startAgentService({
        exec: 'anvil',
        once: true,
        env,
        provider,
        config,
        connect,
      });
      await service.done;
      expect(await store.read('pending.json')).toBeNull();
      expect(await h.client.getTransactionCount({ address: h.agent })).toBe(
        count,
      );
      await service.close();
      service = undefined;
      await exportSnapshot(root, root + '-export');
      const exported = jsonFileStore(root + '-export'),
        receipt = await exported.read(`receipts/${last.receiptHash}.json`);
      const result = await verify(receipt, rpcReader(h.url), {
        agentStore: exported,
      });
      expect(
        result.status,
        result.checks
          .filter((c) => !c.pass)
          .map((c) => c.name)
          .join(','),
      ).toBe('PASS');
      // Exercise the actual verifier CLI on the exported snapshot.
      const { spawn } = await import('node:child_process');
      const cli = spawn(
        process.execPath,
        [
          'packages/verifier/dist/verifier/src/cli.js',
          join(root + '-export', 'receipts', last.receiptHash + '.json'),
          '--rpc',
          h.url,
          '--agent-root',
          root + '-export',
        ],
        { cwd: new URL('../../../', import.meta.url).pathname },
      );
      let output = '';
      cli.stdout.on('data', (d) => {
        output += d;
      });
      cli.stderr.on('data', (d) => {
        output += d;
      });
      const code = await new Promise<number | null>((r) => cli.once('exit', r));
      expect(code, output).toBe(0);
      expect(output).toContain('PASS');
      expect(
        await readFile(join(root + '-export', 'policy.json'), 'utf8'),
      ).toBe(config.policyFile);
    } finally {
      drain();
      await service?.close();
      mock.closeAllConnections();
      await new Promise<void>((r) => mock.close(() => r()));
      await h.stop();
      await rm(root, { recursive: true, force: true });
      await rm(root + '-export', { recursive: true, force: true });
    }
  },
  120000,
);
