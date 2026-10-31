import { useCallback, useRef } from 'react';
import { parseAbiItem } from 'viem';
import { receiptEvent } from '../../../../packages/core/src/abi/index.js';
import {
  clientFor,
  loadDeployment,
  type DashboardChain,
  type Deployment,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
type Client = ReturnType<typeof clientFor>;
type Log = Awaited<ReturnType<typeof receiptLogs>>[number];
const receiptLogs = (
  client: Client,
  vault: Deployment['vault'],
  fromBlock: bigint,
  toBlock: bigint,
) =>
  client.getLogs({
    address: vault,
    event: parseAbiItem(receiptEvent),
    fromBlock,
    toBlock,
  });
export function createReceiptScanner(
  client: Client,
  deployment: Pick<Deployment, 'vault'> & { block?: bigint },
  maxChunks = 3,
) {
  const logs = new Map<string, Log & { at: number }>();
  const timestamps = new Map<bigint, number>();
  let first: bigint | undefined,
    last: bigint | undefined,
    floor: bigint | undefined;
  return async (older = false) => {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    floor ??= deployment.block ?? (head > 4999n ? head - 4999n : 0n);
    const end = older && first !== undefined ? first - 1n : head;
    const beginning = older ? floor : last !== undefined ? last + 1n : floor;
    const start =
      last === undefined || older
        ? end - beginning + 1n > BigInt(maxChunks) * 5000n
          ? end - BigInt(maxChunks) * 5000n + 1n
          : beginning
        : beginning;
    for (let from = start; from <= end; from += 5000n) {
      const to = from + 4999n < end ? from + 4999n : end;
      const batch = await receiptLogs(client, deployment.vault, from, to);
      for (const log of batch) {
        if (log.blockNumber === null) continue;
        if (!timestamps.has(log.blockNumber))
          timestamps.set(
            log.blockNumber,
            Number(
              (await client.getBlock({ blockNumber: log.blockNumber }))
                .timestamp,
            ),
          );
        logs.set(`${log.transactionHash}:${log.logIndex}`, {
          ...log,
          at: timestamps.get(log.blockNumber)!,
        });
      }
    }
    // Advance only after a complete successful scan, so partial failures retry safely.
    if (start <= end) {
      first = first === undefined || start < first ? start : first;
      if (!older) last = head;
    }
    return {
      logs: [...logs.values()].sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? (b.logIndex ?? 0) - (a.logIndex ?? 0)
          : a.blockNumber! > b.blockNumber!
            ? -1
            : 1,
      ),
      from: first ?? floor,
      to: last ?? head,
      hasOlder: (first ?? floor) > floor,
    };
  };
}
export function useReceiptEvents(chain: DashboardChain, enabled = true) {
  const cache = useRef<
    { key: string; scan: ReturnType<typeof createReceiptScanner> } | undefined
  >(undefined);
  const older = useRef(false);
  const resource = useResource(
    useCallback(async () => {
      if (!enabled) return { logs: [], from: 0n, to: 0n, hasOlder: false };
      const deployment = await loadDeployment(chain),
        client = clientFor(chain);
      if ((await client.getChainId()) !== chain)
        throw Error('Receipt network does not match execution network.');
      const key = `${chain}:${deployment.vault}:${deployment.block}`;
      if (cache.current?.key !== key)
        cache.current = { key, scan: createReceiptScanner(client, deployment) };
      const fetchingOlder = older.current;
      older.current = false;
      try {
        return await cache.current.scan(fetchingOlder);
      } catch (error) {
        if (fetchingOlder) older.current = true;
        throw error;
      }
    }, [chain, enabled]),
  );
  return {
    ...resource,
    data: resource.data?.logs,
    range: resource.data && `${resource.data.from}–${resource.data.to}`,
    hasOlder: resource.data?.hasOlder ?? false,
    loadOlder: () => {
      older.current = true;
      return resource.reload();
    },
  };
}
