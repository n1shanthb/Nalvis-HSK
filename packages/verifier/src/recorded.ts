import { z } from 'zod';
import type { Address } from 'viem';
import { minedSchema, type ChainReader } from './verify.js';
/** Offline replay of recorded RPC responses; never substitutes for fetching live chain data. */
export function recordedReader(input: unknown): ChainReader {
  const b = z
    .object({
      chainId: z.number().int(),
      receipts: z.array(minedSchema),
      transactions: z.array(z.record(z.unknown())),
      heads: z.record(z.string().regex(/^0x[0-9a-f]{64}$/)),
      configs: z.record(
        z.object({
          tokenA: z.string(),
          tokenB: z.string(),
          decimalsA: z.number().int(),
          decimalsB: z.number().int(),
          fee: z.number().int(),
        }),
      ),
    })
    .parse(input);
  const find = (hash: string) => {
    const r = b.receipts.find((r) => r.transactionHash === hash);
    if (!r) throw Error('Recorded receipt missing');
    return r;
  };
  return {
    async timestamp(block) {
      const r = b.receipts.find((r) => r.blockNumber === block);
      if (!r || typeof r.blockTimestamp !== 'number')
        throw Error('Recorded block timestamp unavailable');
      return r.blockTimestamp;
    },
    async chainId() {
      return b.chainId;
    },
    async receipt(hash) {
      return find(hash);
    },
    async transaction(hash) {
      const tx = b.transactions.find((t) => t.hash === hash);
      if (!tx) throw Error('Recorded transaction missing');
      return tx;
    },
    async logs(address, from, to) {
      return b.receipts
        .flatMap((r) => r.logs)
        .filter(
          (l) =>
            l.address.toLowerCase() === address.toLowerCase() &&
            l.blockNumber >= from &&
            l.blockNumber <= to,
        );
    },
    async head(address, block) {
      if (!b.receipts.some((r) => r.to.toLowerCase() === address.toLowerCase()))
        throw Error('Unknown contract');
      const h = b.heads[String(block)];
      if (!h) throw Error('Recorded head missing');
      return h as `0x${string}`;
    },
    async config(address, block) {
      if (!b.receipts.some((r) => r.to.toLowerCase() === address.toLowerCase()))
        throw Error('Unknown contract');
      const c = b.configs[String(block)];
      if (!c) throw Error('Recorded config missing');
      return { ...c, tokenA: c.tokenA as Address, tokenB: c.tokenB as Address };
    },
  };
}
