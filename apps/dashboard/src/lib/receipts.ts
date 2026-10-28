import { z } from 'zod';
import { parseAbiItem } from 'viem';
import { receiptEvent } from '../../../../packages/core/src/abi/index.js';
import { receiptSchema, type StoredReceipt } from '../../../../packages/verifier/src/verify.js';
import { clientFor, readJSON, type DashboardChain, type Deployment } from './clients.js';
export async function localReceipts(): Promise<StoredReceipt[]> {
  const index = z.array(z.string().regex(/^\/receipts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.json$/)).parse(await readJSON('/receipts/index.json'));
  const rows = await Promise.all(index.map(async path => receiptSchema.parse(await readJSON(path))));
  return rows;
}
export async function receiptLogs(chain: DashboardChain, deployment: Deployment) {
  const client = clientFor(chain);
  if (await client.getChainId() !== chain) throw Error('RPC chain mismatch');
  const latest = await client.getBlockNumber();
  const logs = [];
  // Keep each RPC query within the documented 5,000 block maximum.
  for (let fromBlock = deployment.block; fromBlock <= latest; fromBlock += 5000n) {
    logs.push(...await client.getLogs({address: [deployment.vault,deployment.router], event: parseAbiItem(receiptEvent), fromBlock, toBlock: fromBlock+4999n < latest ? fromBlock+4999n : latest, strict: true}));
  }
  return logs;
}
