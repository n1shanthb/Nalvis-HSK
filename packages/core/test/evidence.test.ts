import { it, expect } from 'vitest';
import { createPublicClient, http } from 'viem';
import {
  collectEvidence,
  endpoints,
  type EvidenceClient,
} from '../src/evidence.js';
import { evidenceSchema } from '../src/types.js';
import { addresses } from '../src/addresses.js';
import { scenario } from './helpers.js';
const now = 1800000000;
function mocks() {
  const calls: { chain: number; block: bigint; fn: string }[] = [];
  const client = (chain: number): EvidenceClient => ({
    chain: { id: chain },
    getBlock: async () => ({
      number: chain === 177 ? 42n : 99n,
      timestamp: BigInt(now),
    }),
    async readContract(a) {
      calls.push({ chain, block: a.blockNumber, fn: a.functionName });
      switch (a.functionName) {
        case 'slot0':
          return [79228162514264337593543n, 0, 0, 1, 1, 0, true];
        case 'liquidity':
          return 1000000n;
        case 'balanceOf':
          return 1000000000n;
        case 'latestRoundData':
          return [1n, 100000000n, BigInt(now), BigInt(now), 1n];
        case 'mandate': {
          const m = scenario().mandate;
          return [
            addresses[133].whsk.address,
            BigInt(m.expiry),
            m.maxTradeInA,
            m.maxTradeInB,
            m.maxDailyInB,
            m.maxExposureBps,
            m.maxSlippageBps,
            BigInt(m.minIntervalSec),
            m.policyHash,
          ];
        }
        default:
          throw Error('Unexpected read');
      }
    },
    async simulateContract(a) {
      calls.push({ chain, block: a.blockNumber, fn: a.functionName });
      return { result: [100n, 100n, 1, 1n] };
    },
  });
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    let body: unknown;
    if (url === endpoints.graph)
      body = {
        data: { v3Swaps: [{ timestamp: String(now), amountUSD: '10' }] },
      };
    else if (url === endpoints.mexc) body = { bidPrice: '1', askPrice: '1' };
    else body = [{ highest_bid: '1', lowest_ask: '1' }];
    return new Response(JSON.stringify(body));
  };
  return {
    calls,
    requests,
    marketClient177: client(177),
    execClient: client(133),
    fetcher,
    clock: () => now,
    sizes: [10, 25],
  };
}
it('collector pins every read/quote, uses eth_call simulation and POST v3Swaps', async () => {
  const m = mocks(),
    e = await collectEvidence({
      ...m,
      vault: addresses[133].primaryPool.address,
    });
  expect(evidenceSchema.safeParse(e).success).toBe(true);
  expect(e.quotes).toHaveLength(4);
  expect(e.vault).toBeDefined();
  expect(m.calls.every((c) => c.block === (c.chain === 177 ? 42n : 99n))).toBe(
    true,
  );
  expect(m.requests[0].init?.method).toBe('POST');
  expect(m.requests[0].init?.body).toContain('v3Swaps');
  expect(
    Object.values(e.sources).every(
      (s) => s.raw !== undefined && s.fetchedAt === now,
    ),
  ).toBe(true);
});
it('preserves bad responses as error plus raw', async () => {
  const m = mocks();
  m.fetcher = async () => new Response('{"broken":true}');
  const e = await collectEvidence(m);
  expect(e.sources.mexc.error).toBeDefined();
  expect(e.sources.mexc.raw).toEqual({ broken: true });
  expect(e.cex).toEqual([]);
});
it('preserves network failures, RPC failures and unsuccessful block pins', async () => {
  const m = mocks();
  m.marketClient177.getBlock = async () => {
    throw Error('offline');
  };
  m.fetcher = async () => {
    throw Error('offline');
  };
  const e = await collectEvidence(m);
  expect(e.sources.marketBlock.error).toContain('offline');
  expect(e.sources.gate.error).toContain('offline');
  expect(e.sources.slot0).toBeUndefined();
  expect(e.quotes).toEqual([]);
});
it('quote failure is never silently omitted', async () => {
  const m = mocks();
  m.marketClient177.simulateContract = async () => {
    throw Error('reverted');
  };
  const e = await collectEvidence(m);
  expect(e.sources['quote:BUY_A:10'].error).toContain('reverted');
});
it('wrong chain rejected before IO', async () => {
  const m = mocks();
  m.marketClient177.chain = { id: 133 };
  await expect(collectEvidence(m)).rejects.toThrow('177');
});
it.skipIf(process.env.RUN_NETWORK_TESTS !== '1')(
  'opt-in real mainnet read-only evidence',
  async () => {
    const market = createPublicClient({
      chain: {
        id: 177,
        name: 'HashKey',
        nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
        rpcUrls: { default: { http: ['https://mainnet.hsk.xyz'] } },
      },
      transport: http('https://mainnet.hsk.xyz'),
    });
    const exec = createPublicClient({
      chain: {
        id: 133,
        name: 'HashKey testnet',
        nativeCurrency: { name: 'test HSK', symbol: 'HSK', decimals: 18 },
        rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
      },
      transport: http('https://testnet.hsk.xyz'),
    });
    const e = await collectEvidence({
      marketClient177: market,
      execClient: exec,
      sizes: [10, 25, 50, 100],
    });
    expect(evidenceSchema.safeParse(e).success).toBe(true);
    expect(Object.values(e.sources).filter((s) => s.error)).toEqual([]);
  },
  120000,
);
it('HTTP error bodies and invalid JSON remain in raw evidence', async () => {
  const m = mocks();
  m.fetcher = async () =>
    new Response('temporarily unavailable', { status: 503 });
  const e = await collectEvidence(m);
  expect(e.sources.gate.raw).toBe('temporarily unavailable');
  expect(e.sources.gate.error).toContain('Invalid JSON');
  m.fetcher = async () =>
    new Response('{"error":"rate limited"}', { status: 429 });
  const limited = await collectEvidence(m);
  expect(limited.sources.mexc.raw).toEqual({ error: 'rate limited' });
  expect(limited.sources.mexc.error).toContain('HTTP 429');
});
