import { expect, test, vi } from 'vitest';
import { createReceiptScanner } from '../src/agent/useReceiptEvents.js';
import { addresses } from '../../../packages/core/src/addresses.js';
test('chunks history, incrementally polls, caches timestamps, and explicitly loads older pages', async () => {
  let head = 16000n;
  const getLogs = vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => [
    { blockNumber: fromBlock, logIndex: 0, transactionHash: String(fromBlock) },
    { blockNumber: fromBlock, logIndex: 1, transactionHash: String(fromBlock) },
  ]);
  const getBlock = vi.fn(async () => ({ timestamp: 123n }));
  const scan = createReceiptScanner(
    { getBlockNumber: async () => head, getLogs, getBlock } as never,
    { vault: addresses[133].primaryPool.address, block: 1n },
  );
  const first = await scan();
  expect(getLogs.mock.calls.map(([a]) => a.fromBlock)).toEqual([
    1001n,
    6001n,
    11001n,
  ]);
  expect(getBlock).toHaveBeenCalledTimes(3);
  expect(first.hasOlder).toBe(true);
  head = 16002n;
  await scan();
  expect(getLogs.mock.calls.at(-1)?.[0].fromBlock).toBe(16001n);
  await scan();
  expect(getLogs).toHaveBeenCalledTimes(4);
  const older = await scan(true);
  expect(older.from).toBe(1n);
  expect(older.hasOlder).toBe(false);
  expect(getBlock).toHaveBeenCalledTimes(5);
});
