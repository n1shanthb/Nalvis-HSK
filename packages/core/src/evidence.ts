import { parseAbi, zeroAddress, type Address, type Abi } from 'viem';
import { z } from 'zod';
import { addresses, assertWritableChain } from './addresses.js';
import { mandateSchema } from './policy.js';
import {
  evidenceSchema,
  sourceSchema,
  quoteSchema,
  type Evidence,
} from './types.js';
import { inputFor } from './engine-helpers.js';

// All endpoints are documented in docs/ADDRESSES.md. No transaction client is accepted here.
export const endpoints = {
  graph: 'https://graphnode.hashkeychain.net/subgraphs/name/hskdex-subgraph',
  mexc: 'https://api.mexc.com/api/v3/ticker/bookTicker?symbol=HSKUSDT',
  gate: 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=HSK_USDT',
} as const;
const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
]);
const tokenAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
]);
const oracleAbi = parseAbi([
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
]);
const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256,uint160,uint32,uint256)',
]);
const vaultAbi = parseAbi([
  'function mandate() view returns (address,uint256,uint256,uint256,uint256,uint16,uint16,uint256,bytes32)',
]);
const natural = z.bigint().nonnegative();
const positive = z.bigint().positive();
const numericString = z
  .string()
  .refine((s) => Number.isFinite(Number(s)) && Number(s) > 0);
const slotSchema = z.tuple([
  positive,
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.boolean(),
]);
const blockSchema = z.object({ number: natural, timestamp: natural });
const graphSchema = z.object({
  data: z.object({
    v3Swaps: z
      .array(
        z.object({
          timestamp: z.string().regex(/^\d+$/),
          amountUSD: z.string().refine((s) => Number.isFinite(Number(s))),
        }),
      )
      .min(1),
  }),
});
const mexcSchema = z.object({
  bidPrice: numericString,
  askPrice: numericString,
});
const gateSchema = z
  .array(z.object({ highest_bid: numericString, lowest_ask: numericString }))
  .length(1);
const roundSchema = z
  .tuple([positive, positive, natural, positive, positive])
  .refine((r) => r[4] >= r[0]);
const resultSchema = z.tuple([
  positive,
  positive,
  z.number().int().nonnegative(),
  natural,
]);
const mandateRawSchema = z.tuple([
  z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  natural,
  positive,
  positive,
  positive,
  z.number().int(),
  z.number().int(),
  z.number().int(),
  natural,
  z.string(),
]);
class HTTPFailure extends Error {
  constructor(
    message: string,
    readonly raw: unknown,
  ) {
    super(message);
  }
}
export type ReadArgs = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber: bigint;
};
export interface EvidenceClient {
  chain?: { id: number };
  getBlock(): Promise<{ number: bigint | null; timestamp: bigint }>;
  readContract(args: ReadArgs): Promise<unknown>;
  simulateContract(args: ReadArgs): Promise<{ result: unknown }>;
}
export type EvidenceOptions = {
  marketClient177: EvidenceClient;
  execClient: EvidenceClient;
  vault?: Address;
  sizes: number[];
  fetcher?: typeof fetch;
  clock?: () => number;
};

/** Pinned market block and separately pinned execution block; HTTP sources carry their own retrieval times. */
export async function collectEvidence({
  marketClient177: market,
  execClient: exec,
  vault,
  sizes,
  fetcher = fetch,
  clock = () => Math.floor(Date.now() / 1000),
}: EvidenceOptions): Promise<Evidence> {
  if (market.chain?.id !== 177)
    throw new Error('Market client must be chain 177');
  const executionChainId = exec.chain?.id;
  assertWritableChain(executionChainId ?? 0);
  if (executionChainId !== 133 && executionChainId !== 31337)
    throw new Error('Execution chain missing');
  const sources: Evidence['sources'] = {};
  async function capture<T>(
    name: string,
    source: {
      url?: string;
      address?: string;
      method: string;
      chainId?: number;
      blockNumber?: bigint;
    },
    schema: z.ZodType<T>,
    fn: () => Promise<unknown>,
  ): Promise<T | undefined> {
    let raw: unknown = null;
    try {
      raw = await fn();
      const data = schema.parse(raw);
      sources[name] = sourceSchema.parse({
        ...source,
        raw,
        fetchedAt: clock(),
      });
      return data;
    } catch (error) {
      if (error instanceof HTTPFailure) raw = error.raw;
      sources[name] = sourceSchema.parse({
        ...source,
        raw,
        fetchedAt: clock(),
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
  const a = addresses[177];
  const block = await capture(
    'marketBlock',
    {
      url: 'https://mainnet.hsk.xyz',
      method: 'eth_getBlockByNumber',
      chainId: 177,
    },
    blockSchema,
    () => market.getBlock(),
  );
  const execBlock = await capture(
    'executionBlock',
    {
      url: executionChainId === 133 ? 'https://testnet.hsk.xyz' : 'local:anvil',
      method: 'eth_getBlockByNumber',
      chainId: executionChainId,
    },
    blockSchema,
    () => exec.getBlock(),
  );
  const blockNumber = block?.number ?? 0n,
    executionBlockNumber = execBlock?.number ?? 0n;
  const e: Evidence = {
    marketDataChainId: 177,
    executionChainId,
    blockNumber,
    executionBlockNumber,
    now: clock(),
    decimalsA: 18,
    decimalsB: 6,
    cex: [],
    quotes: [],
    sources,
  };
  async function read<T>(
    name: string,
    address: Address,
    abi: Abi,
    fn: string,
    schema: z.ZodType<T>,
    args: readonly unknown[] = [],
    client = market,
    pinned = blockNumber,
  ) {
    return capture(
      name,
      { address, method: fn, chainId: client.chain!.id, blockNumber: pinned },
      schema,
      () =>
        client.readContract({
          address,
          abi,
          functionName: fn,
          args,
          blockNumber: pinned,
        }),
    );
  }
  // A failed pin prevents reads against an accidental "latest" state.
  if (block) {
    const slot = await read(
      'slot0',
      a.primaryPool.address,
      poolAbi,
      'slot0',
      slotSchema,
    );
    await read(
      'liquidity',
      a.primaryPool.address,
      poolAbi,
      'liquidity',
      positive,
    );
    await read('poolBalanceA', a.whsk.address, tokenAbi, 'balanceOf', natural, [
      a.primaryPool.address,
    ]);
    await read('poolBalanceB', a.usdt.address, tokenAbi, 'balanceOf', natural, [
      a.primaryPool.address,
    ]);
    if (slot)
      e.dexMid =
        (Number(slot[0]) ** 2 / 2 ** 192) * 10 ** (e.decimalsA - e.decimalsB);
    const round = await read(
      'apro',
      a.apro.address,
      oracleAbi,
      'latestRoundData',
      roundSchema,
    );
    if (round)
      e.apro = {
        price: Number(round[1]) / 10 ** a.apro.decimals,
        updatedAt: Number(round[3]),
        ageSec: e.now - Number(round[3]),
      };
    if (e.dexMid)
      for (const sizeB of sizes)
        for (const direction of ['BUY_A', 'SELL_A'] as const) {
          const amountIn = inputFor(direction, sizeB, e),
            buy = direction === 'BUY_A';
          const result = await capture(
            `quote:${direction}:${sizeB}`,
            {
              address: a.quoterV2.address,
              method: 'eth_call:quoteExactInputSingle',
              chainId: 177,
              blockNumber,
            },
            resultSchema,
            async () =>
              (
                await market.simulateContract({
                  address: a.quoterV2.address,
                  abi: quoterAbi,
                  functionName: 'quoteExactInputSingle',
                  blockNumber,
                  args: [
                    {
                      tokenIn: buy ? a.usdt.address : a.whsk.address,
                      tokenOut: buy ? a.whsk.address : a.usdt.address,
                      amountIn,
                      fee: 3000,
                      sqrtPriceLimitX96: 0n,
                    },
                  ],
                })
              ).result,
          );
          if (result) {
            const parsed = quoteSchema.safeParse({
              direction,
              sizeB,
              amountIn,
              quotedOut: result[0],
            });
            if (parsed.success) e.quotes.push(parsed.data);
            else
              sources[`quote:${direction}:${sizeB}`].error =
                parsed.error.message;
          }
        }
  }
  async function http(url: string, init?: RequestInit) {
    const r = await fetcher(url, {
      signal: AbortSignal.timeout(15000),
      ...init,
    });
    const text = await r.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HTTPFailure('Invalid JSON response', text);
    }
    if (!r.ok) throw new HTTPFailure(`HTTP ${r.status}`, raw);
    return raw;
  }

  const graph = await capture(
    'lastSwap',
    { url: endpoints.graph, method: 'POST GraphQL' },
    graphSchema,
    () =>
      http(endpoints.graph, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: `{v3Swaps(first:1,orderBy:timestamp,orderDirection:desc,where:{pool:"${a.primaryPool.address.toLowerCase()}"}){timestamp amountUSD}}`,
        }),
      }),
  );
  if (graph) e.lastSwapAt = Number(graph.data.v3Swaps[0].timestamp);
  const mexc = await capture(
    'mexc',
    { url: endpoints.mexc, method: 'GET' },
    mexcSchema,
    () => http(endpoints.mexc),
  );
  if (mexc)
    e.cex.push({
      venue: 'mexc',
      bid: Number(mexc.bidPrice),
      ask: Number(mexc.askPrice),
      fetchedAt: sources.mexc.fetchedAt,
    });
  const gate = await capture(
    'gate',
    { url: endpoints.gate, method: 'GET' },
    gateSchema,
    () => http(endpoints.gate),
  );
  if (gate)
    e.cex.push({
      venue: 'gate',
      bid: Number(gate[0].highest_bid),
      ask: Number(gate[0].lowest_ask),
      fetchedAt: sources.gate.fetchedAt,
    });
  if (vault && execBlock) {
    const config = addresses[executionChainId === 133 ? 133 : 177];
    const ba = await read(
      'vaultBalanceA',
      config.whsk.address,
      tokenAbi,
      'balanceOf',
      natural,
      [vault],
      exec,
      executionBlockNumber,
    );
    const bb = await read(
      'vaultBalanceB',
      config.usdt.address,
      tokenAbi,
      'balanceOf',
      natural,
      [vault],
      exec,
      executionBlockNumber,
    );
    const m = await read(
      'mandate',
      vault,
      vaultAbi,
      'mandate',
      mandateRawSchema,
      [],
      exec,
      executionBlockNumber,
    );
    if (ba !== undefined && bb !== undefined && m) {
      const parsed = mandateSchema.safeParse({
        revoked: m[0] === zeroAddress,
        expiry: Number(m[1]),
        maxTradeInA: m[2],
        maxTradeInB: m[3],
        maxDailyInB: m[4],
        maxExposureBps: m[5],
        maxSlippageBps: m[6],
        maxDrawdownBps: m[7],
        minIntervalSec: Number(m[8]),
        policyHash: m[9],
      });
      if (parsed.success)
        e.vault = {
          decimalsA: config.whsk.decimals,
          decimalsB: config.usdt.decimals,
          balanceA: ba,
          balanceB: bb,
          mandate: parsed.data,
        };
      else sources.mandate.error = parsed.error.message;
    }
  }
  e.now = clock();
  if (e.apro) e.apro.ageSec = e.now - e.apro.updatedAt;
  return evidenceSchema.parse(e);
}
