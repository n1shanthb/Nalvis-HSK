import { useCallback } from 'react';
import { parseAbiItem } from 'viem';
import { receiptEvent } from '../../../../packages/core/src/abi/index.js';
import {
  clientFor,
  loadDeployment,
  type DashboardChain,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
export function useReceiptEvents(chain: DashboardChain, enabled = true) {
  return useResource(
    useCallback(async () => {
      if (!enabled) return [];
      const deployment = await loadDeployment(chain);
      const client = clientFor(chain);
      if ((await client.getChainId()) !== chain)
        throw Error('Receipt network does not match execution network.');
      const latest = await client.getBlockNumber();
      // Bounded recent timeline, with deployment lower bound. No build-time receipt index.
      const start = latest > 4999n ? latest - 4999n : 0n;
      const logs = await client.getLogs({
        address: deployment.vault,
        event: parseAbiItem(receiptEvent),
        fromBlock: deployment.block > start ? deployment.block : start,
        toBlock: latest,
      });
      const blocks = await Promise.all(
        [...new Set(logs.map((l) => l.blockNumber))].map((number) =>
          client.getBlock({ blockNumber: number }),
        ),
      );
      return logs
        .map((log) => ({
          ...log,
          at: Number(
            blocks.find((b) => b.number === log.blockNumber)?.timestamp ?? 0n,
          ),
        }))
        .reverse();
    }, [chain, enabled]),
  );
}
