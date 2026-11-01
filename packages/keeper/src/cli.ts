#!/usr/bin/env node
import { agentCommand, exportAgentCommand } from './agent-service.js';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { encodeFunctionData, zeroHash } from 'viem';
import {
  OpenAICompatibleChooser,
  type PresetChooser,
} from '../../core/src/index.js';
import { vaultAbi, proofRouterAbi } from '../../core/src/abi/index.js';
import {
  parseOptions,
  loadPolicy,
  loadDeployment,
  assertTestnetHuman,
} from './config.js';
import { fixtureScenario } from './demo.js';
import { connectExecution } from './execution.js';
import {
  tick,
  withLock,
  receiptFiles,
  readReceipt,
  type Execution,
} from './runner.js';

export async function main(
  argv = process.argv.slice(2),
  injectedExecution?: Execution,
) {
  if (argv[0] === 'agent') return agentCommand(argv.slice(1));
  if (argv[0] === 'export-agent') return exportAgentCommand(argv.slice(1));
  const options = parseOptions([...argv]);
  if (options.exec === 'testnet') assertTestnetHuman();
  const policy = loadPolicy();
  let execution: Execution;
  let chooser: PresetChooser | undefined;
  if (process.env.LLM_API_KEY && options.exec !== 'dry') {
    if (!process.env.LLM_ENDPOINT || !process.env.LLM_MODEL)
      throw new Error(
        'LLM key requires explicit LLM_ENDPOINT and LLM_MODEL; no guessed endpoint',
      );
    chooser = new OpenAICompatibleChooser(
      process.env.LLM_ENDPOINT,
      process.env.LLM_MODEL,
    );
  }
  if (options.exec === 'dry') {
    const fixture = fixtureScenario(policy, options.demo);
    // Offline receipts have a documented zero contract sentinel, never a deployment.
    const contract = '0x0000000000000000000000000000000000000000' as const;
    let seq = 0n;
    for (const name of await receiptFiles(join(options.receipts, '31337'))) {
      const r = await readReceipt(join(options.receipts, '31337', name));
      if (r.contract === contract && BigInt(r.seq) >= seq)
        seq = BigInt(r.seq) + 1n;
    }
    execution = {
      chainId: 31337,
      contract,
      async reconcile() {
        return 0;
      },
      async snapshot() {
        return {
          seq: seq++,
          head: zeroHash,
          nonce: 0n,
          now: fixture.evidence.now,
          mandate: fixture.mandate,
          state: fixture.state,
          executionDecimalsA: 18,
          executionDecimalsB: 6,
        };
      },
      async check() {},
      async collect() {
        return structuredClone(fixture.evidence);
      },
      async quote(direction, amountIn) {
        const q = fixture.evidence.quotes.find(
          (q) => q.direction === direction && q.amountIn === amountIn,
        );
        if (!q) throw new Error('Missing fixture quote');
        return { quote: q.quotedOut, floor: 0n };
      },
      calldata(r) {
        const kind = ['TRADE', 'RESIZE', 'WAIT', 'REJECT'].indexOf(
          r.decision.kind,
        );
        if (kind < 2) return '0x'; // Unsigned offline intent only; no deployed token addresses.
        return encodeFunctionData({
          abi: options.target === 'vault' ? vaultAbi : proofRouterAbi,
          functionName: 'commitHold',
          args: [r.receiptHash, r.prevHead, kind],
        });
      },
      async send() {
        throw new Error('Dry mode never sends');
      },
    };
  } else
    execution =
      injectedExecution ??
      (await connectExecution(
        options,
        policy,
        loadDeployment(
          options.exec === 'testnet' ? 133 : 31337,
          options.deployment,
        ),
      ));
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await withLock(
      join(options.receipts, String(execution.chainId)),
      async () => {
        do {
          await tick(options, policy, execution, chooser);
          if (options.once || stopped) break;
          await new Promise<void>((resolve) => {
            const halt = () => {
              clearTimeout(timer);
              process.off('SIGINT', halt);
              process.off('SIGTERM', halt);
              resolve();
            };
            const timer = setTimeout(halt, options.interval * 1000);
            process.once('SIGINT', halt);
            process.once('SIGTERM', halt);
          });
        } while (!stopped);
      },
    );
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      'Keeper stopped safely. Check deployment, RPC, mandate and pending journal; no automatic resend.',
    );
    process.exitCode = 1;
  });
