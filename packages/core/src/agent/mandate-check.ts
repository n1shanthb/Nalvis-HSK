import { z } from 'zod';
import {
  parseUnits,
  zeroAddress,
  zeroHash,
  encodeFunctionData,
  decodeErrorResult,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { vaultAbi, erc20Abi, poolReadAbi } from '../abi/index.js';
import { readCachedTurnover } from './turnover.js';
import { assertWritableChain } from '../addresses.js';
import { hash } from '../canonical.js';
import { meanTick, twapOutput } from './twap.js';
import { actionSchema, type Action } from './schema.js';
const uint = z
  .union([z.bigint(), z.string().regex(/^\d+$/).transform(BigInt)])
  .pipe(z.bigint().nonnegative());
const addr = z
  .string()
  .regex(/^0x[\da-fA-F]{40}$/)
  .transform((v) => v as Address);
const hex = z
  .string()
  .regex(/^0x[\da-fA-F]{64}$/)
  .transform((v) => v as Hex);
export const mandateStateSchema = z
  .object({
    chainId: z.union([z.literal(133), z.literal(31337)]),
    vault: addr,
    agent: addr,
    tokenA: addr,
    tokenB: addr,
    decimalsA: z.number().int().min(0).max(38),
    decimalsB: z.number().int().min(0).max(38),
    block: uint,
    blockTime: z.number().int().nonnegative(),
    mandate: z
      .object({
        agent: addr,
        expiry: uint,
        maxTradeInA: uint,
        maxTradeInB: uint,
        maxDailyInB: uint,
        maxExposureBps: z.number().int().min(0).max(10000),
        maxSlippageBps: z.number().int().min(0).max(100),
        maxDrawdownBps: z.number().int().min(0).max(10000),
        minIntervalSec: uint,
        policyHash: hex,
      })
      .strict(),
    paused: z.boolean(),
    revoked: z.boolean(),
    lastTradeAt: uint,
    spentB: uint,
    turnover: z.array(
      z.object({ expiresAt: z.number().int(), amountB: uint }).strict(),
    ),
    highWaterMark: uint,
    balanceA: uint,
    balanceB: uint,
    tick: z.number().int().min(-887272).max(887272),
    head: hex,
    nextNonce: uint,
    seq: uint,
    pending: z.boolean(),
    oracleOk: z.boolean(),
    twapOk: z.boolean(),
  })
  .strict();
export type MandateState = z.infer<typeof mandateStateSchema>;
export type ExecQuote = {
  block: bigint;
  at: number;
  amountIn: bigint;
  amountOut: bigint;
};
export type Prepared = {
  kind: 'TRADE' | 'RESIZE' | 'WAIT' | 'REJECT';
  direction: 'BUY' | 'SELL' | 'HOLD';
  tokenIn: Address;
  amountIn: bigint;
  minOut: bigint;
  validUntil: number;
  deadline: number;
  nonce: bigint;
  prevHead: Hex;
};
export type Violation = {
  limit: string;
  required: string;
  allowed: string;
  resetsAt?: number;
};
export type CheckResult = {
  ok: boolean;
  violations: Violation[];
  headroom: {
    maxNowA: bigint;
    maxNowB: bigint;
    dailyRemainingB: bigint;
    nextTradeAt: number;
    exposureRoomB: bigint;
    drawdownRoomB: bigint;
    expiresAt: number;
    paused: boolean;
    revoked: boolean;
  };
  prepared: Prepared;
};
export const quoteTwap = (s: MandateState, n: bigint, buy: boolean) =>
  twapOutput(
    s.tick,
    n,
    BigInt(buy ? s.tokenB : s.tokenA) < BigInt(buy ? s.tokenA : s.tokenB),
  );
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);
/** USDT sizing uses ONLY the execution TWAP and execution token decimals. */
export function amountFor(action: Action, s: MandateState): bigint {
  if (action.type === 'HOLD') return 0n;
  const b = parseUnits(action.notionalB!, s.decimalsB);
  if (action.type === 'BUY') return b;
  const unit = 10n ** BigInt(s.decimalsA),
    price = quoteTwap(s, unit, false);
  if (price === 0n) throw new Error('Execution TWAP has zero price');
  return (b * unit) / price;
}
/** Solidity integer operations/rounding, including post-fill exposure and drawdown. */
export function check(
  action: Action,
  state: MandateState,
  execQuote: ExecQuote,
  overrides: Partial<Prepared> = {},
): CheckResult {
  actionSchema.parse(action);
  const s = mandateStateSchema.parse(state),
    m = s.mandate;
  const buy = action.type === 'BUY',
    amountIn = amountFor(action, s),
    refOut = quoteTwap(s, amountIn, buy);
  const slippage = Math.min(
    action.maxSlippageBps ?? m.maxSlippageBps,
    m.maxSlippageBps,
  );
  const prepared: Prepared = {
    kind: action.type === 'HOLD' ? 'WAIT' : 'TRADE',
    direction: action.type,
    tokenIn: buy ? s.tokenB : s.tokenA,
    amountIn,
    minOut: max(
      (execQuote.amountOut * BigInt(10000 - slippage)) / 10000n,
      (refOut * BigInt(10000 - m.maxSlippageBps)) / 10000n,
    ),
    validUntil: s.blockTime + 120,
    deadline: s.blockTime + 120,
    nonce: s.nextNonce,
    prevHead: s.head,
    ...overrides,
  };
  const p = prepared,
    violations: Violation[] = [];
  const fail = (
    limit: string,
    required: unknown,
    allowed: unknown,
    resetsAt?: number,
  ) =>
    violations.push({
      limit,
      required: String(required),
      allowed: String(allowed),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    });
  const preA = quoteTwap(s, s.balanceA, false),
    total = preA + s.balanceB,
    high = max(s.highWaterMark, total);
  const remaining = max(0n, m.maxDailyInB - s.spentB),
    next = Number(s.lastTradeAt + m.minIntervalSec);
  const headroom = {
    maxNowA: min(m.maxTradeInA, s.balanceA),
    maxNowB: min(min(m.maxTradeInB, s.balanceB), remaining),
    dailyRemainingB: remaining,
    nextTradeAt: next,
    exposureRoomB: max(0n, (total * BigInt(m.maxExposureBps)) / 10000n - preA),
    drawdownRoomB: total - (high * BigInt(10000 - m.maxDrawdownBps)) / 10000n,
    expiresAt: Number(m.expiry),
    paused: s.paused,
    revoked: s.revoked,
  };
  if (s.paused || s.revoked || BigInt(s.blockTime) >= m.expiry)
    fail('Inactive', 'live mandate', 'paused/revoked/expired');
  if (
    s.agent.toLowerCase() !== m.agent.toLowerCase() ||
    s.agent === zeroAddress
  )
    fail('Unauthorized', s.agent, m.agent);
  if (s.pending)
    fail('Pending', 'no pending transaction', 'pending transaction');
  if (p.prevHead !== s.head) fail('PreviousHead', p.prevHead, s.head);
  if (
    action.type === 'HOLD' &&
    (p.amountIn !== 0n ||
      p.minOut !== 0n ||
      !['WAIT', 'REJECT'].includes(p.kind))
  )
    fail('HoldFields', 'zero amounts and hold kind', p.kind);
  if (action.type === 'HOLD')
    return { ok: violations.length === 0, violations, headroom, prepared: p };
  if (!['TRADE', 'RESIZE'].includes(p.kind))
    fail('InvalidKind', p.kind, 'TRADE|RESIZE');
  if (p.validUntil < s.blockTime)
    fail('DecisionExpired', p.validUntil, s.blockTime);
  if (p.deadline < s.blockTime || p.deadline > s.blockTime + 120)
    fail('Deadline', p.deadline, s.blockTime + 120);
  if (p.nonce !== s.nextNonce) fail('Nonce', p.nonce, s.nextNonce);
  if (s.blockTime < next) fail('Interval', s.blockTime, next, next);
  if (
    ![s.tokenA.toLowerCase(), s.tokenB.toLowerCase()].includes(
      p.tokenIn.toLowerCase(),
    )
  )
    fail('InvalidToken', p.tokenIn, 'vault pair');
  if (p.tokenIn.toLowerCase() !== (buy ? s.tokenB : s.tokenA).toLowerCase())
    fail('Direction', p.tokenIn, buy ? s.tokenB : s.tokenA);
  if (p.amountIn !== amountIn) fail('Sizing', p.amountIn, amountIn);
  if (p.amountIn === 0n || p.amountIn > (buy ? m.maxTradeInB : m.maxTradeInA))
    fail('TradeCap', p.amountIn, buy ? m.maxTradeInB : m.maxTradeInA);
  if (!s.twapOk) fail('TWAP', 'readable TWAP', 'unavailable');
  if (!s.oracleOk)
    fail('OracleInvalid', 'valid oracle', 'unavailable/outside band');
  if (
    execQuote.block !== s.block ||
    execQuote.at > s.blockTime ||
    s.blockTime - execQuote.at > 20 ||
    execQuote.amountIn !== p.amountIn
  )
    fail('FreshQuote', 'same-block execution quote', execQuote.block);
  if (
    refOut === 0n ||
    p.minOut < (refOut * BigInt(10000 - m.maxSlippageBps)) / 10000n
  )
    fail(
      'Slippage',
      p.minOut,
      (refOut * BigInt(10000 - m.maxSlippageBps)) / 10000n,
    );
  if (
    m.maxDrawdownBps > 0 &&
    total < (high * BigInt(10000 - m.maxDrawdownBps)) / 10000n
  )
    fail('Drawdown', total, (high * BigInt(10000 - m.maxDrawdownBps)) / 10000n);
  const notional = buy ? p.amountIn : refOut;
  if (s.spentB + notional > m.maxDailyInB)
    fail(
      'DailyCap',
      s.spentB + notional,
      m.maxDailyInB,
      s.turnover
        .filter((t) => t.amountB > 0n)
        .sort((a, b) => a.expiresAt - b.expiresAt)[0]?.expiresAt,
    );
  if (p.amountIn > (buy ? s.balanceB : s.balanceA))
    fail('Balance', p.amountIn, buy ? s.balanceB : s.balanceA);
  if (execQuote.amountOut < p.minOut)
    fail('Underfill', execQuote.amountOut, p.minOut);
  if (p.amountIn <= (buy ? s.balanceB : s.balanceA)) {
    const afterA = buy
      ? s.balanceA + execQuote.amountOut
      : s.balanceA - p.amountIn;
    const afterB = buy
      ? s.balanceB - p.amountIn
      : s.balanceB + execQuote.amountOut;
    const valueA = quoteTwap(s, afterA, false),
      postTotal = valueA + afterB;
    if (
      m.maxDrawdownBps > 0 &&
      postTotal < (high * BigInt(10000 - m.maxDrawdownBps)) / 10000n
    )
      fail(
        'DrawdownPost',
        postTotal,
        (high * BigInt(10000 - m.maxDrawdownBps)) / 10000n,
      );
    const threshold =
      total === 0n ? 0n : (preA * postTotal + total - 1n) / total;
    if (
      valueA > (postTotal * BigInt(m.maxExposureBps)) / 10000n &&
      valueA >= threshold
    )
      fail('Exposure', valueA, (postTotal * BigInt(m.maxExposureBps)) / 10000n);
  }
  return { ok: violations.length === 0, violations, headroom, prepared: p };
}
export function calldata(p: Prepared, receiptHash: Hex): Hex {
  const kind = ['TRADE', 'RESIZE', 'WAIT', 'REJECT'].indexOf(p.kind);
  return p.kind === 'WAIT' || p.kind === 'REJECT'
    ? encodeFunctionData({
        abi: vaultAbi,
        functionName: 'commitHold',
        args: [receiptHash, p.prevHead, kind],
      })
    : encodeFunctionData({
        abi: vaultAbi,
        functionName: 'trade',
        args: [
          {
            tokenIn: p.tokenIn,
            amountIn: p.amountIn,
            minOut: p.minOut,
            deadline: BigInt(p.deadline),
            validUntil: BigInt(p.validUntil),
            nonce: p.nonce,
            receiptHash,
            prevHead: p.prevHead,
            kind,
          },
        ],
      });
}
const errorAbi = parseAbi([
  'error Unauthorized()',
  'error Inactive()',
  'error InvalidKind()',
  'error PreviousHead()',
  'error DecisionExpired()',
  'error Deadline()',
  'error Nonce()',
  'error Interval()',
  'error TradeCap()',
  'error DailyCap()',
  'error Exposure()',
  'error Slippage()',
  'error Underfill()',
  'error InvalidToken()',
  'error OracleInvalid()',
  'error Drawdown()',
  'error InvalidConfig()',
]);
export async function simulate(
  client: Pick<PublicClient, 'call'>,
  s: MandateState,
  p: Prepared,
  receiptHash: Hex = zeroHash,
): Promise<{ ok: boolean; error?: string; block: bigint }> {
  try {
    await client.call({
      account: s.agent,
      to: s.vault,
      data: calldata(p, receiptHash),
      blockNumber: s.block,
    });
    return { ok: true, block: s.block };
  } catch (e) {
    let current: unknown = e;
    let name = 'eth_call reverted';
    for (let i = 0; i < 8 && current && typeof current === 'object'; i++) {
      const row = current as {
        data?: unknown;
        cause?: unknown;
        errorName?: string;
      };
      if (row.errorName) name = row.errorName;
      if (typeof row.data === 'string') {
        try {
          name = decodeErrorResult({
            abi: errorAbi,
            data: row.data as Hex,
          }).errorName;
        } catch {
          /* retain bounded generic error */
        }
      }
      current = row.cause;
    }
    return { ok: false, error: name, block: s.block };
  }
}
/** All reads pinned to one block. Reconstruct private turnover buckets from canonical Receipt events. */
export async function readMandateState(
  client: PublicClient,
  vault: Address,
  block?: bigint,
  agent?: Address,
): Promise<MandateState> {
  const chainId = await client.getChainId();
  assertWritableChain(chainId);
  const b = await client.getBlock(
      block === undefined ? {} : { blockNumber: block },
    ),
    blockNumber = b.number;
  const read = (
    fn: string,
    address: Address = vault,
    abi: readonly unknown[] = vaultAbi,
    args: unknown[] = [],
  ) =>
    client.readContract({
      address,
      abi,
      functionName: fn,
      args,
      blockNumber,
    } as never) as Promise<unknown>;
  const [raw, tokenARaw, tokenBRaw, poolRaw, windowRaw] = await Promise.all([
    read('mandate'),
    read('tokenA'),
    read('tokenB'),
    read('pool'),
    read('twapWindowSec'),
  ]);
  const m = z
    .tuple([
      addr,
      uint,
      uint,
      uint,
      uint,
      z.number(),
      z.number(),
      z.number(),
      uint,
      hex,
    ])
    .parse(raw);
  const tokenA = addr.parse(tokenARaw),
    tokenB = addr.parse(tokenBRaw),
    pool = addr.parse(poolRaw),
    window = z.number().parse(windowRaw);
  const [
    da,
    db,
    ba,
    bb,
    paused,
    lastTradeAt,
    spentB,
    highWaterMark,
    head,
    nextNonce,
    seq,
  ] = await Promise.all([
    read('decimals', tokenA, erc20Abi),
    read('decimals', tokenB, erc20Abi),
    read('balanceOf', tokenA, erc20Abi, [vault]),
    read('balanceOf', tokenB, erc20Abi, [vault]),
    read('paused'),
    read('lastTradeAt'),
    read('dailyNotionalB'),
    read('highWaterMark'),
    read('head'),
    read('nextNonce'),
    read('seq'),
  ]);
  let tick = 0,
    twapOk = true;
  try {
    const observed = await read('observe', pool, poolReadAbi, [[window, 0]]);
    const c = z
      .tuple([z.array(z.bigint()).min(2), z.array(z.bigint())])
      .parse(observed)[0];
    tick = meanTick(c[0], c[1], window);
    if (Math.abs(tick) > 887272) throw Error('tick');
  } catch {
    twapOk = false;
  }
  const oracleAbi = parseAbi([
    'function oracle() view returns (address)',
    'function oracleBandBps() view returns (uint16)',
    'function oracleMaxAge() view returns (uint256)',
    'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
    'function decimals() view returns (uint8)',
  ]);
  const oracle = addr.parse(await read('oracle', vault, oracleAbi));
  let oracleOk = true;
  if (oracle !== zeroAddress) {
    try {
      const [round, answer, , updated, answered] = z
        .tuple([uint, z.bigint(), uint, uint, uint])
        .parse(await read('latestRoundData', oracle, oracleAbi));
      const dec = z
        .number()
        .int()
        .min(0)
        .max(38)
        .parse(await read('decimals', oracle, oracleAbi));
      const band = BigInt(
          z.number().parse(await read('oracleBandBps', vault, oracleAbi)),
        ),
        age = uint.parse(await read('oracleMaxAge', vault, oracleAbi));
      const price =
          (answer * 10n ** BigInt(z.number().parse(db))) / 10n ** BigInt(dec),
        twap = twapOutput(
          tick,
          10n ** BigInt(z.number().parse(da)),
          BigInt(tokenA) < BigInt(tokenB),
        );
      oracleOk =
        answer > 0n &&
        updated > 0n &&
        updated <= b.timestamp &&
        b.timestamp - updated <= age &&
        answered >= round &&
        price > 0n &&
        (twap > price ? twap - price : price - twap) <= (price * band) / 10000n;
    } catch {
      oracleOk = false;
    }
  }
  const turnover = await readCachedTurnover(client, {
    chainId,
    vault,
    tokenB,
    block: {
      number: blockNumber,
      timestamp: b.timestamp,
      hash: b.hash,
      parentHash: b.parentHash,
    },
    spentB: uint.parse(spentB),
  });
  const sender = agent ?? m[0];
  const [latest, pending] = await Promise.all([
    client.getTransactionCount({ address: sender, blockTag: 'latest' }),
    client.getTransactionCount({ address: sender, blockTag: 'pending' }),
  ]);
  return mandateStateSchema.parse({
    chainId,
    vault,
    agent: sender,
    tokenA,
    tokenB,
    decimalsA: da,
    decimalsB: db,
    block: blockNumber,
    blockTime: Number(b.timestamp),
    mandate: {
      agent: m[0],
      expiry: m[1],
      maxTradeInA: m[2],
      maxTradeInB: m[3],
      maxDailyInB: m[4],
      maxExposureBps: m[5],
      maxSlippageBps: m[6],
      maxDrawdownBps: m[7],
      minIntervalSec: m[8],
      policyHash: m[9],
    },
    paused,
    revoked: m[0] === zeroAddress,
    lastTradeAt,
    spentB,
    turnover,
    highWaterMark,
    balanceA: ba,
    balanceB: bb,
    tick,
    head,
    nextNonce,
    seq,
    pending: latest !== pending,
    oracleOk,
    twapOk,
  });
}
export const stateHash = (s: MandateState) => hash(s);
