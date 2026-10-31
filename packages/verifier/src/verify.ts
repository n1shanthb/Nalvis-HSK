import { z } from 'zod';
import {
  createPublicClient,
  http,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  toBytes,
  zeroAddress,
  zeroHash,
  parseAbiItem,
  type Hex,
  type Address,
} from 'viem';
import {
  canonical,
  evidenceHash,
  receiptHash,
  policyHash,
  policySchema,
  mandateSchema,
  engineStateSchema,
  parseEvidenceJSON,
  decide,
  addresses,
  type ReceiptBody,
} from '../../core/src/index.js';
import {
  vaultAbi,
  proofRouterAbi,
  receiptEvent,
  erc20Abi,
} from '../../core/src/abi/index.js';
import { canonicalCheck } from './canonical-check.js';

const hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as Hex);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v as Address);
export const integer = z
  .union([z.bigint(), z.string().regex(/^\d+$/).transform(BigInt)])
  .pipe(z.bigint().nonnegative());
const trace = z.array(
  z
    .object({ rule: z.string(), pass: z.boolean(), detail: z.string() })
    .strict(),
);
export const receiptSchema = z
  .object({
    version: z.literal(1),
    chainId: z.union([z.literal(133), z.literal(31337)]),
    marketDataChainId: z.literal(177),
    executionChainId: z.union([z.literal(133), z.literal(31337)]),
    contract: address.refine((v) => v !== zeroAddress),
    seq: integer,
    prevHead: hex,
    policyHash: hex,
    evidenceHash: hex,
    receiptHash: hex,
    evidence: z.record(z.unknown()),
    decision: z
      .object({
        kind: z.enum(['TRADE', 'RESIZE', 'WAIT', 'REJECT']),
        direction: z.enum(['BUY_A', 'SELL_A']).optional(),
        sizeB: z.number().positive().optional(),
        amountIn: integer.optional(),
        minOut: integer.optional(),
        validUntil: z.number().int().nonnegative().optional(),
        riskCheck: z
          .object({
            samples: z.number().int().positive(),
            sigma: z.number().finite().nonnegative(),
            worstCostBps: z.number().finite(),
            accepted: z.boolean(),
          })
          .strict()
          .optional(),
        ruleTrace: trace,
      })
      .strict(),
    ruleTrace: trace,
    llm: z
      .object({
        model: z.string().optional(),
        promptHash: hex.optional(),
        outputHash: hex.optional(),
        explanation: z.string(),
      })
      .strict(),
    tx: z
      .object({
        to: address,
        data: z
          .string()
          .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
          .transform((v) => v as Hex),
        minOut: integer,
        deadline: z.number().int().nonnegative(),
        validUntil: z.number().int().nonnegative().optional(),
        nonce: integer,
      })
      .strict(),
    settlement: z.object({ transactionHash: hex }).passthrough().optional(),
  })
  .strict();
export type StoredReceipt = z.infer<typeof receiptSchema>;
const logSchema = z
  .object({
    address,
    data: z
      .string()
      .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
      .transform((v) => v as Hex),
    topics: z.array(hex).min(1),
    transactionHash: hex,
    blockNumber: integer,
    logIndex: z.number().int().nonnegative(),
  })
  .passthrough();
export const minedSchema = z
  .object({
    transactionHash: hex,
    blockHash: hex,
    blockNumber: integer,
    status: z.literal('success'),
    to: address,
    from: address,
    gasUsed: integer,
    effectiveGasPrice: integer,
    logs: z.array(logSchema),
  })
  .passthrough();
export type Mined = z.infer<typeof minedSchema>;
export type RawLog = z.infer<typeof logSchema>;
const transactionSchema = z
  .object({
    hash: hex,
    from: address,
    to: address,
    input: z.string().transform((v) => v as Hex),
    blockHash: hex,
    blockNumber: integer,
  })
  .passthrough();
export type Transaction = z.infer<typeof transactionSchema>;
export interface ChainReader {
  timestamp?(block: bigint): Promise<number>;
  chainId(): Promise<number>;
  receipt(hash: Hex): Promise<unknown>;
  transaction(hash: Hex): Promise<unknown>;
  logs(address: Address, from: bigint, to: bigint): Promise<unknown[]>;
  head(address: Address, block: bigint, caller?: Address): Promise<Hex>;
  config(
    address: Address,
    block: bigint,
  ): Promise<{
    tokenA: Address;
    tokenB: Address;
    decimalsA: number;
    decimalsB: number;
    fee: number;
  }>;
}
const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
export const chainHead = (prevHead: Hex, hash: Hex, seq: bigint) =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }],
      [prevHead, hash, seq],
    ),
  );
export type Check = { name: string; pass: boolean; detail?: string };
export type Metrics = {
  realisedPrice: number | null;
  slippageQuoteBps: number | null;
  slippageTwapBps: number | null;
  poolFeeInput: string;
  poolFeeRatePpm: number;
  gasUsed: string;
  effectiveGasPrice: string;
  gasHSK: number;
  gasUSD: number | null;
  amountIn: string;
  amountOut: string;
  refOut: string;
  buy: boolean;
  decimalsA: number;
  decimalsB: number;
  cexMid: number | null;
};
export type Verification = {
  status: 'PASS' | 'FAIL';
  checks: Check[];
  label: string;
  headAfter?: Hex;
  metrics?: Metrics;
  receipt?: StoredReceipt;
};
class Failed extends Error {}
/** Read-only RPC adapter. Never constructs a wallet or broadcasts. */
export function rpcReader(url: string): ChainReader {
  const client = createPublicClient({
    transport: http(url, { retryCount: 0, timeout: 15000 }),
  });
  return {
    timestamp: async (blockNumber) =>
      Number((await client.getBlock({ blockNumber })).timestamp),
    chainId: () => client.getChainId(),
    receipt: (hash) => client.getTransactionReceipt({ hash }),
    transaction: (hash) => client.getTransaction({ hash }),
    logs: (contract, fromBlock, toBlock) =>
      client.getLogs({
        address: contract,
        event: parseAbiItem(receiptEvent),
        fromBlock,
        toBlock,
      }),
    async head(contract, blockNumber, caller) {
      return client.readContract({
        address: contract,
        abi: caller ? proofRouterAbi : vaultAbi,
        functionName: 'head',
        args: caller ? [caller] : [],
        blockNumber,
      } as never) as Promise<Hex>;
    },
    async config(contract, blockNumber) {
      // Vault exposes tokens/fee. Router fixes the supported pair through the address config.
      let tokenA: Address, tokenB: Address, fee: number;
      const code = await client.getCode({ address: contract, blockNumber });
      if (!code || code === '0x') throw Error('Missing execution contract');
      try {
        [tokenA, tokenB, fee] = await Promise.all([
          client.readContract({
            address: contract,
            abi: vaultAbi,
            functionName: 'tokenA',
            blockNumber,
          }),
          client.readContract({
            address: contract,
            abi: vaultAbi,
            functionName: 'tokenB',
            blockNumber,
          }),
          client.readContract({
            address: contract,
            abi: vaultAbi,
            functionName: 'fee',
            blockNumber,
          }),
        ]);
      } catch {
        const id = await client.getChainId();
        const cfg = addresses[id === 133 ? 133 : 177];
        tokenA = cfg.whsk.address;
        tokenB = cfg.usdt.address;
        fee = 3000;
      }
      const [decimalsA, decimalsB] = await Promise.all(
        [tokenA, tokenB].map((token) =>
          client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: 'decimals',
            blockNumber,
          }),
        ),
      );
      return { tokenA, tokenB, fee, decimalsA, decimalsB };
    },
  };
}
export function decodeReceipt(log: RawLog) {
  const decoded = decodeEventLog({
    abi: [parseAbiItem(receiptEvent)],
    data: log.data,
    topics: log.topics as [Hex, ...Hex[]],
    strict: true,
  });
  return decoded.args;
}
function restoreFields(value: unknown, keys: string[]) {
  const row = z.record(z.unknown()).parse(value);
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      keys.includes(k) ? integer.parse(v) : v,
    ]),
  );
}
/** All checks fail closed with a stable name, including malformed JSON/RPC payloads. */
export async function verify(
  input: unknown,
  reader: ChainReader,
  options: { txHash?: Hex; chain?: number } = {},
): Promise<Verification> {
  const result: Verification = {
    status: 'FAIL',
    checks: [],
    label: 'execution — prices not real',
  };
  let current = 'receipt_schema';
  const check = (name: string, pass: boolean, detail?: string) => {
    current = name;
    result.checks.push({ name, pass, ...(detail ? { detail } : {}) });
    if (!pass) throw new Failed(name);
  };
  try {
    const r = receiptSchema.parse(input);
    result.receipt = r;
    result.label =
      r.executionChainId === 133
        ? 'testnet — prices not real'
        : 'local anvil — prices not real';
    check(
      'chain_ids',
      r.chainId === r.executionChainId &&
        r.evidence.executionChainId === r.executionChainId &&
        r.evidence.marketDataChainId === 177,
    );
    current = 'canonical_evidence';
    check(current, canonical(r.evidence) === canonicalCheck(r.evidence));
    check('evidenceHash', evidenceHash(r.evidence) === r.evidenceHash);
    // Freeze the field list independently rather than borrowing core's receipt projection.
    const independent = {
      version: r.version,
      chainId: r.chainId,
      marketDataChainId: r.marketDataChainId,
      executionChainId: r.executionChainId,
      contract: r.contract,
      seq: r.seq,
      prevHead: r.prevHead,
      policyHash: r.policyHash,
      evidenceHash: r.evidenceHash,
      evidence: r.evidence,
      decision: r.decision,
      ruleTrace: r.ruleTrace,
      llm: r.llm,
      tx: {
        to: r.tx.to,
        minOut: r.tx.minOut,
        deadline: r.tx.deadline,
        nonce: r.tx.nonce,
        ...(r.tx.validUntil !== undefined
          ? { validUntil: r.tx.validUntil }
          : {}),
      },
    };
    const coreHash = receiptHash(r as unknown as ReceiptBody);
    check(
      'canonical_receipt',
      coreHash === keccak256(toBytes(canonicalCheck(independent))),
    );
    check('receiptHash', coreHash === r.receiptHash);
    current = 'replay_snapshot';
    const evidence = parseEvidenceJSON(canonical(r.evidence));
    const raw = z
      .object({ policy: z.unknown(), mandate: z.unknown(), state: z.unknown() })
      .strict()
      .parse(evidence.sources.replay?.raw);
    const policy = policySchema.parse(raw.policy);
    const mandate = mandateSchema.parse(
      restoreFields(raw.mandate, ['maxTradeInA', 'maxTradeInB', 'maxDailyInB']),
    );
    const state = engineStateSchema.parse(
      restoreFields(raw.state, ['balanceA', 'balanceB', 'dailySpentB']),
    );
    check(
      'policyHash',
      policyHash(policy) === r.policyHash &&
        mandate.policyHash === r.policyHash,
    );
    if (
      evidence.validUntil !== undefined ||
      r.tx.validUntil !== undefined ||
      r.decision.validUntil !== undefined
    )
      check(
        'decision_expiry',
        evidence.validUntil === evidence.now + (policy.decisionTtlSec ?? 120) &&
          r.tx.validUntil === evidence.validUntil &&
          r.decision.validUntil === evidence.validUntil &&
          r.tx.deadline <= evidence.validUntil!,
      );
    const replay = decide(evidence, policy, mandate, state);
    check(
      'decision_replay',
      canonical(replay) === canonical(r.decision) &&
        canonical(r.ruleTrace) === canonical(r.decision.ruleTrace),
    );
    const trading = r.decision.kind === 'TRADE' || r.decision.kind === 'RESIZE';
    current = 'execution_quote';
    const quote = trading
      ? z
          .object({
            amountIn: integer,
            quote: integer,
            minOut: integer,
            marketAmountIn: integer,
          })
          .strict()
          .parse(evidence.sources.executionQuote?.raw)
      : undefined;
    const txHash = options.txHash ?? r.settlement?.transactionHash;
    check(
      'transaction_hash',
      !!txHash && (!r.settlement || same(txHash, r.settlement.transactionHash)),
    );
    current = 'rpc_chain';
    check(current, (await reader.chainId()) === r.executionChainId);
    current = 'mined_receipt';
    const mined = minedSchema.parse(await reader.receipt(txHash!));
    if (r.tx.validUntil !== undefined) {
      const at = reader.timestamp
        ? await reader.timestamp(mined.blockNumber)
        : undefined;
      check(
        'mined_before_expiry',
        at !== undefined && at >= evidence.now && at <= r.tx.validUntil,
      );
    }
    current = 'mined_transaction';
    const tx = transactionSchema.parse(await reader.transaction(txHash!));
    check(
      'transaction_binding',
      same(mined.transactionHash, txHash) &&
        same(tx.hash, txHash) &&
        same(mined.to, r.contract) &&
        same(tx.to, r.contract) &&
        same(r.tx.to, r.contract) &&
        same(mined.from, tx.from) &&
        same(tx.blockHash, mined.blockHash) &&
        tx.blockNumber === mined.blockNumber &&
        same(tx.input, r.tx.data),
    );
    current = 'receipt_event';
    const logs = mined.logs
      .filter((l) => same(l.address, r.contract))
      .flatMap((l) => {
        try {
          return [{ raw: l, event: decodeReceipt(l) }];
        } catch {
          return [];
        }
      });
    check('receipt_event', logs.length === 1);
    const { event: ev, raw: rawLog } = logs[0];
    check(
      'event_origin',
      same(rawLog.transactionHash, txHash) &&
        rawLog.blockNumber === mined.blockNumber,
    );
    for (const key of ['receiptHash', 'prevHead', 'seq', 'policyHash'] as const)
      check(`event_${key}`, same(ev[key], r[key]));
    check(
      'event_kind',
      ev.kind ===
        ['TRADE', 'RESIZE', 'WAIT', 'REJECT'].indexOf(r.decision.kind),
    );
    check('event_minOut', ev.minOut === r.tx.minOut);
    current = 'execution_config';
    const cfg = await reader.config(r.contract, mined.blockNumber);
    const buy = r.decision.direction === 'BUY_A';
    const token = trading ? (buy ? cfg.tokenB : cfg.tokenA) : zeroAddress;
    check('event_tokenIn', same(ev.tokenIn, token));
    check('event_amountIn', ev.amountIn === (quote?.amountIn ?? 0n));
    if (trading && quote) {
      const from = buy ? evidence.decimalsB : evidence.decimalsA,
        to = buy ? cfg.decimalsB : cfg.decimalsA;
      check(
        'execution_amount',
        quote.marketAmountIn === r.decision.amountIn &&
          quote.amountIn ===
            (quote.marketAmountIn * 10n ** BigInt(to)) / 10n ** BigInt(from),
      );
      check(
        'execution_minOut',
        quote.quote > 0n &&
          quote.minOut === r.tx.minOut &&
          ev.minOut >=
            (quote.quote * BigInt(10000 - mandate.maxSlippageBps)) / 10000n &&
          ev.minOut >=
            (ev.refOut * BigInt(10000 - mandate.maxSlippageBps)) / 10000n &&
          ev.minOut <= quote.quote &&
          ev.amountOut >= ev.minOut,
      );
    } else
      check(
        'hold_amounts',
        ev.amountIn === 0n &&
          ev.amountOut === 0n &&
          ev.minOut === 0n &&
          ev.refOut === 0n,
      );
    current = 'calldata';
    const call = decodeFunctionData({
      abi: [...vaultAbi, ...proofRouterAbi],
      data: tx.input,
    });
    const router = call.functionName === 'commitAndSwap';
    if (trading) {
      check('calldata_method', call.functionName === 'trade' || router);
      const p = (
        call.functionName === 'trade' ? call.args![0] : call.args![2]
      ) as {
        tokenIn: Address;
        amountIn: bigint;
        minOut?: bigint;
        amountOutMinimum?: bigint;
        receiptHash?: Hex;
        prevHead?: Hex;
        deadline?: bigint;
        validUntil?: bigint;
        nonce?: bigint;
        kind?: number;
      };
      check(
        'calldata_amounts',
        same(p.tokenIn, ev.tokenIn) &&
          p.amountIn === ev.amountIn &&
          (p.minOut ?? p.amountOutMinimum) === ev.minOut,
      );
      if (!router)
        check(
          'calldata_commitment',
          same(p.receiptHash, r.receiptHash) &&
            same(p.prevHead, r.prevHead) &&
            p.deadline === BigInt(r.tx.deadline) &&
            (r.tx.validUntil === undefined ||
              p.validUntil === BigInt(r.tx.validUntil)) &&
            p.nonce === r.tx.nonce &&
            p.kind === ev.kind,
        );
      else {
        const deadline = (
          call.args!.length > 4 ? call.args![4] : call.args![3]
        ) as bigint;
        check(
          'calldata_commitment',
          same(call.args![0], r.receiptHash) &&
            same(call.args![1], r.prevHead) &&
            deadline === BigInt(r.tx.deadline) &&
            (r.tx.validUntil === undefined ||
              call.args![3] === BigInt(r.tx.validUntil)) &&
            ev.kind === 0,
        );
      }
    } else
      check(
        'calldata_hold',
        call.functionName === 'commitHold' &&
          same(call.args![0], r.receiptHash) &&
          same(call.args![1], r.prevHead) &&
          call.args![2] === ev.kind,
      );
    // A router hold shares the vault selector. Probe only the historical head view.
    let caller: Address | undefined = router ? tx.from : undefined;
    let head: Hex;
    current = 'head_after';
    try {
      head = await reader.head(r.contract, mined.blockNumber, caller);
    } catch (error) {
      if (trading) throw error;
      caller = tx.from;
      head = await reader.head(r.contract, mined.blockNumber, caller);
    }
    const count = options.chain ?? 1;
    check(
      'chain_depth',
      Number.isSafeInteger(count) && count >= 0 && count <= 10000,
    );
    let cursor = ev,
      needed = Math.min(count, Number(ev.seq)),
      end = mined.blockNumber;
    let blockHead = chainHead(ev.prevHead, ev.receiptHash, ev.seq);
    result.headAfter = blockHead;
    // Bound RPC queries to the chain's supported 5,000-block range; validate caller isolation.
    while (true) {
      current = 'chain_logs';
      const start = end > 4999n ? end - 4999n : 0n;
      const rows = (await reader.logs(r.contract, start, end))
        .map((l) => logSchema.parse(l))
        .sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? a.logIndex - b.logIndex
            : a.blockNumber < b.blockNumber
              ? -1
              : 1,
        );
      const own = [];
      for (const row of rows) {
        check(
          'chain_log_origin',
          same(row.address, r.contract) &&
            row.blockNumber >= start &&
            row.blockNumber <= end,
        );
        if (caller) {
          const t = transactionSchema.parse(
            await reader.transaction(row.transactionHash),
          );
          if (!same(t.from, caller)) continue;
        }
        own.push({ row, event: decodeReceipt(row) });
      }
      if (end === mined.blockNumber) {
        let blockSeq = ev.seq;
        for (const { row, event } of own.filter(
          (x) =>
            x.row.blockNumber === mined.blockNumber &&
            x.row.logIndex > rawLog.logIndex,
        )) {
          void row;
          check(
            'same_block_link',
            event.seq === blockSeq + 1n && event.prevHead === blockHead,
          );
          blockHead = chainHead(event.prevHead, event.receiptHash, event.seq);
          blockSeq = event.seq;
        }
        check('head_after', head === blockHead);
      }
      for (const { row, event } of own.reverse()) {
        if (
          row.blockNumber === mined.blockNumber &&
          row.logIndex >= rawLog.logIndex
        )
          continue;
        if (!needed) break;
        check('chain_sequence', event.seq + 1n === cursor.seq);
        check(
          'chain_prevHead',
          chainHead(event.prevHead, event.receiptHash, event.seq) ===
            cursor.prevHead,
        );
        cursor = event;
        needed--;
      }
      if (!needed) break;
      check('chain_previous_exists', start > 0n);
      end = start - 1n;
    }
    if (cursor.seq === 0n) check('chain_genesis', cursor.prevHead === zeroHash);
    const mid =
      evidence.cex.reduce((a, c) => a + (c.bid + c.ask) / 2, 0) /
      evidence.cex.length;
    check(
      'valuation',
      (!trading || (Number.isFinite(mid) && mid > 0)) &&
        cfg.decimalsA >= 0 &&
        cfg.decimalsA <= 36 &&
        cfg.decimalsB >= 0 &&
        cfg.decimalsB <= 36 &&
        cfg.fee >= 0 &&
        cfg.fee < 1000000,
    );
    const inputAmount =
        Number(ev.amountIn) / 10 ** (buy ? cfg.decimalsB : cfg.decimalsA),
      outputAmount =
        Number(ev.amountOut) / 10 ** (buy ? cfg.decimalsA : cfg.decimalsB);
    const gasHSK = Number(mined.gasUsed * mined.effectiveGasPrice) / 1e18;
    result.metrics = {
      realisedPrice: trading
        ? buy
          ? inputAmount / outputAmount
          : outputAmount / inputAmount
        : null,
      slippageQuoteBps: quote
        ? Number(((quote.quote - ev.amountOut) * 100000000n) / quote.quote) /
          10000
        : null,
      slippageTwapBps: ev.refOut
        ? Number(((ev.refOut - ev.amountOut) * 100000000n) / ev.refOut) / 10000
        : null,
      poolFeeInput: (
        (ev.amountIn * BigInt(cfg.fee) + 999999n) /
        1000000n
      ).toString(),
      poolFeeRatePpm: cfg.fee,
      gasUsed: String(mined.gasUsed),
      effectiveGasPrice: String(mined.effectiveGasPrice),
      gasHSK,
      gasUSD: Number.isFinite(mid) && mid > 0 ? gasHSK * mid : null,
      amountIn: String(ev.amountIn),
      amountOut: String(ev.amountOut),
      refOut: String(ev.refOut),
      buy,
      decimalsA: cfg.decimalsA,
      decimalsB: cfg.decimalsB,
      cexMid: Number.isFinite(mid) && mid > 0 ? mid : null,
    };
    result.status = 'PASS';
  } catch (error) {
    if (!(error instanceof Failed))
      result.checks.push({
        name: current,
        pass: false,
        detail:
          error instanceof z.ZodError
            ? 'Invalid data'
            : error instanceof Error
              ? error.message
              : 'Verification error',
      });
  }
  return result;
}
