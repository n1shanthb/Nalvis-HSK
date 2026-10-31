import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  open,
  unlink,
} from 'node:fs/promises';
import { hash } from '../../core/src/canonical.js';
import { join } from 'node:path';
import { zeroHash, type Address, type Hex } from 'viem';
import {
  assertWritableChain,
  canonical,
  buildReceipt,
  decide,
  choosePreset,
  DeterministicChooser,
  receiptHash,
  type Evidence,
  type EngineState,
  type Mandate,
  type Policy,
  type PresetChooser,
  type ReceiptBody,
} from '../../core/src/index.js';
import { repositoryRoot, type Options } from './config.js';

export type Snapshot = {
  blockNumber?: bigint;
  seq: bigint;
  head: Hex;
  nonce: bigint;
  now: number;
  mandate: Mandate;
  state: EngineState;
  executionDecimalsA: number;
  executionDecimalsB: number;
};
export type Settlement = {
  transactionHash: Hex;
  blockNumber: bigint;
  status: 'success';
  log: {
    seq: bigint;
    receiptHash: Hex;
    prevHead: Hex;
    policyHash: Hex;
    kind: number;
    tokenIn: Address;
    amountIn: bigint;
    amountOut: bigint;
    minOut: bigint;
    refOut: bigint;
  };
  gasUsed: bigint;
  effectiveGasPrice: bigint;
};
export interface Execution {
  quoteAddress?: Address;
  chainId: 133 | 31337;
  contract: Address;
  snapshot(): Promise<Snapshot>;
  collect(snapshot: Snapshot): Promise<Evidence>;
  quote(
    direction: 'BUY_A' | 'SELL_A',
    amountIn: bigint,
    snapshot: Snapshot,
  ): Promise<{ quote: bigint; floor: bigint }>;
  calldata(receipt: ReceiptBody & { receiptHash: Hex }): Hex;
  check(snapshot: Snapshot): Promise<void>;
  send(
    data: Hex,
    onHash: (hash: Hex) => Promise<void>,
    validUntil: number,
  ): Promise<Settlement>;
  // Reconcile from chain, including committed JSON files whose settlement append was interrupted.
  reconcile(directory: string): Promise<number>;
}
export function istSummary(
  kind: string,
  hash: Hex,
  mode: string,
  demo: boolean,
) {
  return `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date())} IST ${demo ? 'DEMO — synthetic scenario; no proven edge — ' : ''}${mode === 'testnet' ? 'testnet: prices are not real — ' : mode + ' '}${kind} receipt=${hash}`;
}
export async function saveJSON(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, canonical(value) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
export async function receiptFiles(directory: string) {
  await mkdir(directory, { recursive: true });
  return (await readdir(directory)).filter((f) =>
    /^\d+-0x[0-9a-f]{64}\.json$/.test(f),
  );
}
export async function readReceipt(path: string) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  // canonical hashing uses identical bigint/decimal-string encoding; raw source bodies stay verbatim.
  if (receiptHash(raw) !== raw.receiptHash)
    throw new Error(`Receipt integrity failure: ${path}`);
  return raw;
}
/** Exclusive directory lock; stale locks require a human to check pending txs and remove the lock. */
export async function withLock<T>(
  directory: string,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, '.keeper.lock');
  const handle = await open(path, 'wx').catch(() => {
    throw new Error(
      `Keeper lock exists: ${path}; check pending transactions before removing`,
    );
  });
  try {
    await handle.writeFile(String(process.pid));
    return await fn();
  } finally {
    await handle.close();
    await unlink(path);
  }
}
export async function tick(
  options: Options,
  policy: Policy,
  execution: Execution,
  chooser: PresetChooser = new DeterministicChooser(),
) {
  assertWritableChain(execution.chainId);
  const directory = join(options.receipts, String(execution.chainId));
  await mkdir(directory, { recursive: true });
  const dailyLoss = await execution.reconcile(directory);
  const snapshot = await execution.snapshot();
  // Run even for holds: a revoked agent must not submit anything.
  await execution.check(snapshot);
  const evidence = await execution.collect(snapshot);
  evidence.validUntil = evidence.now + (policy.decisionTtlSec ?? 120);
  const history = JSON.parse(
    await readFile(
      join(repositoryRoot(), 'data/research/market_history.json'),
      'utf8',
    ),
  );
  const sigma = Number(history.summary.cex_hourly_logret_pct.stdev) / 100;
  if (!Number.isFinite(sigma) || sigma < 0 || sigma > 1)
    throw new Error('Invalid historical volatility');
  evidence.riskInput = {
    sigma,
    observations: history.summary.hours_in_window - 1,
    historyHash: hash(history),
  };
  evidence.sources.keeperState = {
    address: execution.contract,
    method: 'execution-state',
    chainId: execution.chainId,
    blockNumber: snapshot.blockNumber ?? evidence.executionBlockNumber,
    fetchedAt: evidence.now,
    raw: {
      state: { ...snapshot.state, dailyLossB: dailyLoss },
      mandate: snapshot.mandate,
    },
  };
  const choice = await choosePreset(
    'Market evidence hash and selected policy preset; execution is deterministic.',
    [options.preset],
    chooser,
  );
  const state = {
    ...snapshot.state,
    preset: choice.preset,
    llmValid: choice.valid,
    dailyLossB: dailyLoss,
  };
  // Commit the exact replay inputs, including the final validated chooser result.
  evidence.sources.replay = {
    address: execution.contract,
    method: 'deterministic-replay-inputs-v1',
    chainId: execution.chainId,
    blockNumber: snapshot.blockNumber ?? evidence.executionBlockNumber,
    fetchedAt: evidence.now,
    raw: { policy, mandate: snapshot.mandate, state },
  };
  const decision = decide(evidence, policy, snapshot.mandate, state);
  evidence.sources.riskSimulation = {
    address: execution.contract,
    method: 'seeded-bounded-price-stress-v1',
    fetchedAt: evidence.now,
    raw: decision.riskCheck ?? {
      skipped:
        'No executable candidate after deterministic quality/mandate gates',
    },
  };
  let minOut = 0n;
  if (decision.kind === 'TRADE' || decision.kind === 'RESIZE') {
    if (!decision.amountIn || !decision.direction)
      throw new Error('Invalid trade decision');
    // Convert only units, never execution-chain fake prices. USD sizing came from mainnet.
    const marketDecimals =
      decision.direction === 'BUY_A' ? evidence.decimalsB : evidence.decimalsA;
    const execDecimals =
      decision.direction === 'BUY_A'
        ? snapshot.executionDecimalsB
        : snapshot.executionDecimalsA;
    const amountIn =
      (decision.amountIn * 10n ** BigInt(execDecimals)) /
      10n ** BigInt(marketDecimals);
    try {
      const { quote, floor } = await execution.quote(
        decision.direction,
        amountIn,
        snapshot,
      );
      if (quote <= 0n) throw new Error('Empty execution quote');
      minOut =
        (quote * BigInt(10000 - snapshot.mandate.maxSlippageBps)) / 10000n;
      minOut = minOut > floor ? minOut : floor;
      if (!minOut || minOut > quote) throw new Error('Unfillable TWAP floor');
      // Execution data is separately labelled; the engine verdict/market amounts remain replayable.
      evidence.sources.executionQuote = {
        address: execution.quoteAddress ?? execution.contract,
        method: 'eth_call:QuoterV2',
        chainId: execution.chainId,
        blockNumber: snapshot.blockNumber ?? evidence.executionBlockNumber,
        fetchedAt: evidence.now,
        raw: { amountIn, quote, minOut, marketAmountIn: decision.amountIn },
      };
    } catch {
      minOut = 0n;
      decision.kind = 'REJECT';
      delete decision.amountIn;
      delete decision.minOut;
      delete decision.direction;
      delete decision.sizeB;
      decision.ruleTrace.push({
        rule: 'execution_quote',
        pass: false,
        detail: 'Execution-chain quote unavailable; no trade',
      });
    }
  }
  const receipt = buildReceipt({
    contract: execution.contract,
    seq: snapshot.seq,
    prevHead: snapshot.head,
    policy,
    evidence,
    decision,
    llm: {
      explanation: `${options.demo || options.exec === 'dry' ? 'DEMO: synthetic evidence; no proven edge. ' : ''}${choice.explanation}`,
      promptHash: choice.promptHash,
      outputHash: choice.outputHash,
    },
    tx: {
      to: execution.contract,
      data: '0x',
      minOut,
      deadline: Math.min(snapshot.now + 120, evidence.validUntil),
      validUntil: evidence.validUntil,
      nonce: snapshot.nonce,
    },
  });
  receipt.tx.data = execution.calldata(receipt);
  const path = join(directory, `${receipt.seq}-${receipt.receiptHash}.json`);
  await saveJSON(path, receipt);
  if (options.exec !== 'dry') {
    // This intent is durable before any signature/broadcast. Uncertain sends never auto-retry.
    await execution.check(snapshot);
    const fresh = await execution.snapshot();
    if (
      fresh.now > evidence.validUntil ||
      (execution.chainId === 133 &&
        Math.floor(Date.now() / 1000) > evidence.validUntil)
    )
      throw new Error('Stale decision dropped before signing');
    const pending = join(directory, '.pending.json');
    await saveJSON(pending, {
      contract: execution.contract,
      seq: snapshot.seq,
      head: snapshot.head,
      receiptHash: receipt.receiptHash,
      path,
    });
    const settlement = await execution.send(
      receipt.tx.data,
      async (transactionHash) => {
        await saveJSON(pending, {
          contract: execution.contract,
          seq: snapshot.seq,
          receiptHash: receipt.receiptHash,
          path,
          transactionHash,
        });
      },
      evidence.validUntil,
    );
    if (
      settlement.log.receiptHash !== receipt.receiptHash ||
      settlement.log.seq !== snapshot.seq ||
      settlement.log.prevHead !== snapshot.head
    )
      throw new Error('Settlement does not match receipt');
    await saveJSON(path, { ...receipt, settlement });
    await unlink(pending);
  }
  console.log(
    istSummary(
      decision.kind,
      receipt.receiptHash,
      options.exec,
      !!options.demo || options.exec === 'dry',
    ),
  );
  return { receipt, path };
}
export const emptyHead = zeroHash;
