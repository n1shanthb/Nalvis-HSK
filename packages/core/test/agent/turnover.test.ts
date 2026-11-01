import { it, expect, vi } from 'vitest';
import type { Hex } from 'viem';
import {
  createTurnoverReader,
  type TurnoverClient,
} from '../../src/agent/turnover.js';
import { fixtureState } from './fixtures.js';
const hex = (n: bigint) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;
function mockChain() {
  const state = fixtureState();
  let fork = 0n;
  const header = (number: bigint, timestamp = 1000000n + number * 60n) => ({
    number,
    timestamp,
    hash: hex(number + 100n + fork),
    parentHash: hex(number + 99n + fork),
  });
  const logs = [
    {
      blockNumber: 10n,
      args: { kind: 0, tokenIn: state.tokenB, amountIn: 100n, refOut: 999n },
    },
    {
      blockNumber: 10n,
      args: { kind: 1, tokenIn: state.tokenA, amountIn: 50n, refOut: 200n },
    },
    {
      blockNumber: 11n,
      args: { kind: 2, tokenIn: state.tokenA, amountIn: 0n, refOut: 0n },
    },
  ];
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
    header(blockNumber),
  );
  const getLogs = vi.fn(
    async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      logs.filter(
        (l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
      ),
  );
  const client = { getBlock, getLogs } as unknown as TurnoverClient;
  const reader = createTurnoverReader(client);
  const request = (
    number: bigint,
    spentB = 300n,
    override?: ReturnType<typeof header>,
  ) => ({
    chainId: 31337,
    vault: state.vault,
    tokenB: state.tokenB,
    block: override ?? header(number),
    spentB,
  });
  return {
    reader,
    request,
    getBlock,
    getLogs,
    header,
    logs,
    reorg() {
      fork += 10000n;
    },
  };
}
it('caches block timestamps, scans only new blocks and skips unchanged targets', async () => {
  const c = mockChain();
  const first = await c.reader(c.request(20n));
  expect(first.map((r) => r.amountB)).toEqual([100n, 200n]);
  expect(
    c.getBlock.mock.calls.filter(([r]) => r.blockNumber === 10n),
  ).toHaveLength(1);
  c.logs.push({
    blockNumber: 21n,
    args: {
      kind: 0,
      tokenIn: fixtureState().tokenB,
      amountIn: 300n,
      refOut: 300n,
    },
  });
  const second = await c.reader(c.request(21n, 600n));
  expect(second.map((r) => r.amountB)).toEqual([100n, 200n, 300n]);
  expect(c.getLogs.mock.calls[1][0]).toMatchObject({
    fromBlock: 21n,
    toBlock: 21n,
  });
  const blockCalls = c.getBlock.mock.calls.length,
    logCalls = c.getLogs.mock.calls.length;
  expect(await c.reader(c.request(21n, 600n))).toEqual(second);
  expect(c.getLogs).toHaveBeenCalledTimes(logCalls);
  expect(c.getBlock).toHaveBeenCalledTimes(blockCalls);
  await c.reader(c.request(24n, 600n));
  expect(c.getLogs.mock.calls[2][0]).toMatchObject({
    fromBlock: 22n,
    toBlock: 24n,
  });
  expect(
    c.getBlock.mock.calls.filter(([r]) => r.blockNumber === 10n),
  ).toHaveLength(1);
});
it('expires old buckets even if no new trade logs arrive', async () => {
  const c = mockChain();
  await c.reader(c.request(20n));
  expect(await c.reader(c.request(21n, 0n, c.header(21n, 1200000n)))).toEqual(
    [],
  );
});
it('a turnover mismatch refuses execution, clears the cursor and can rebuild', async () => {
  const c = mockChain();
  await c.reader(c.request(20n));
  await expect(c.reader(c.request(21n, 301n))).rejects.toMatchObject({
    code: 'TURNOVER_MISMATCH',
    message: expect.stringContaining(
      'reconstructed 300 tokenB units, on-chain 301',
    ),
  });
  expect(await c.reader(c.request(21n))).toHaveLength(2);
  expect(c.getLogs.mock.calls.at(-1)![0].fromBlock).toBe(0n);
});
it('reorgs and historical reads rebuild rather than reuse later receipts', async () => {
  const c = mockChain();
  await c.reader(c.request(20n));
  c.reorg();
  await c.reader(c.request(21n));
  expect(c.getLogs.mock.calls.at(-1)![0].fromBlock).toBe(0n);
  await c.reader(c.request(5n, 0n));
  expect(c.getLogs.mock.calls.at(-1)![0]).toMatchObject({
    fromBlock: 0n,
    toBlock: 5n,
  });
});
it('a target block changing during a scan is rejected', async () => {
  const c = mockChain();
  c.getBlock.mockImplementation(async ({ blockNumber }) => {
    const b = c.header(blockNumber);
    return blockNumber === 20n ? { ...b, hash: hex(999999n) } : b;
  });
  await expect(c.reader(c.request(20n))).rejects.toMatchObject({
    code: 'TURNOVER_REORG',
  });
});
it('RPC failures are fail-closed and bounded to a safe diagnostic', async () => {
  const c = mockChain();
  c.getLogs.mockRejectedValueOnce(new Error('untrusted transport detail'));
  await expect(c.reader(c.request(20n))).rejects.toMatchObject({
    code: 'TURNOVER_UNAVAILABLE',
    message: expect.stringContaining(
      'Receipt history or block timestamps unavailable',
    ),
  });
});
it('incremental scans remain chunked to at most 5,000 blocks', async () => {
  const c = mockChain();
  await c.reader(c.request(20n));
  await c.reader(c.request(10021n, 0n));
  for (const [r] of c.getLogs.mock.calls)
    expect(r.toBlock - r.fromBlock).toBeLessThanOrEqual(4999n);
});
