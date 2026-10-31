import { parseAbiItem, type PublicClient, type Address, type Hex } from 'viem';
import { receiptEvent } from '../abi/index.js';

export class MandateStateReadError extends Error {
  constructor(
    readonly code:
      'TURNOVER_MISMATCH' | 'TURNOVER_UNAVAILABLE' | 'TURNOVER_REORG',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'MandateStateReadError';
  }
}
type Header = { number: bigint; timestamp: bigint; hash: Hex; parentHash: Hex };
type Row = { block: bigint; expiresAt: number; amountB: bigint };
type Cache = {
  lastBlock: bigint;
  lastHash: Hex;
  headers: Map<bigint, Header>;
  rows: Row[];
};
type Request = {
  chainId: number;
  vault: Address;
  tokenB: Address;
  block: Header;
  spentB: bigint;
};
export type TurnoverClient = Pick<PublicClient, 'getBlock' | 'getLogs'>;
/** Client-scoped, serialized, reorg-aware cache. Restarts rebuild from chain. */
export function createTurnoverReader(client: TurnoverClient) {
  const caches = new Map<string, Cache>();
  let queue = Promise.resolve();
  async function read(
    request: Request,
  ): Promise<{ expiresAt: number; amountB: bigint }[]> {
    const { chainId, vault, tokenB, block, spentB } = request;
    const key = `${chainId}:${vault.toLowerCase()}:${tokenB.toLowerCase()}`;
    try {
      let cached = caches.get(key);
      if (cached) {
        if (
          block.number < cached.lastBlock ||
          (block.number === cached.lastBlock && block.hash !== cached.lastHash)
        )
          cached = undefined;
        else if (block.number > cached.lastBlock) {
          const ancestorHash =
            block.number === cached.lastBlock + 1n
              ? block.parentHash
              : (await client.getBlock({ blockNumber: cached.lastBlock })).hash;
          if (ancestorHash !== cached.lastHash) cached = undefined;
        }
      }
      const fresh = !cached;
      const cache: Cache = cached ?? {
        lastBlock: block.number,
        lastHash: block.hash,
        headers: new Map(),
        rows: [],
      };
      cache.headers.set(block.number, block);
      const header = async (n: bigint) => {
        let h = cache.headers.get(n);
        if (!h) {
          const b = await client.getBlock({ blockNumber: n });
          h = {
            number: b.number,
            timestamp: b.timestamp,
            hash: b.hash,
            parentHash: b.parentHash,
          };
          cache.headers.set(n, h);
        }
        return h;
      };
      const now = Number(block.timestamp),
        since = (Math.floor(now / 1800) - 47) * 1800;
      let start = cache.lastBlock + 1n;
      if (fresh) {
        let lo = 0n,
          hi = block.number;
        while (lo < hi) {
          const mid = (lo + hi) / 2n;
          if (Number((await header(mid)).timestamp) < since) lo = mid + 1n;
          else hi = mid;
        }
        start = lo;
      }
      const rows = cache.rows.filter((r) => r.expiresAt > now);
      for (let from = start; from <= block.number; from += 5000n) {
        const logs = await client.getLogs({
          address: vault,
          event: parseAbiItem(receiptEvent),
          fromBlock: from,
          toBlock: from + 4999n > block.number ? block.number : from + 4999n,
        });
        for (const log of logs) {
          if (log.args.kind !== 0 && log.args.kind !== 1) continue;
          if (
            log.blockNumber === null ||
            typeof log.args.tokenIn !== 'string' ||
            typeof log.args.amountIn !== 'bigint' ||
            typeof log.args.refOut !== 'bigint'
          )
            throw new MandateStateReadError(
              'TURNOVER_UNAVAILABLE',
              'Incomplete Receipt log; refusing execution',
            );
          const timestamp = Number((await header(log.blockNumber)).timestamp);
          const expiresAt = (Math.floor(timestamp / 1800) + 48) * 1800;
          if (expiresAt > now)
            rows.push({
              block: log.blockNumber,
              expiresAt,
              amountB:
                log.args.tokenIn.toLowerCase() === tokenB.toLowerCase()
                  ? log.args.amountIn
                  : log.args.refOut,
            });
        }
      }
      // Do not publish a cursor built across a moving/reorganized target block.
      if (
        start <= block.number &&
        (await client.getBlock({ blockNumber: block.number })).hash !==
          block.hash
      )
        throw new MandateStateReadError(
          'TURNOVER_REORG',
          `Block ${block.number} changed during scan; refusing execution`,
        );
      const reconstructed = rows.reduce((n, r) => n + r.amountB, 0n);
      if (reconstructed !== spentB)
        throw new MandateStateReadError(
          'TURNOVER_MISMATCH',
          `Block ${block.number}: reconstructed ${reconstructed} tokenB units, on-chain ${spentB}; refusing execution`,
        );
      cache.rows = rows;
      cache.lastBlock = block.number;
      cache.lastHash = block.hash;
      for (const [n, h] of cache.headers)
        if (Number(h.timestamp) < since) cache.headers.delete(n);
      caches.set(key, cache);
      return rows.map(({ expiresAt, amountB }) => ({ expiresAt, amountB }));
    } catch (e) {
      caches.delete(key);
      if (e instanceof MandateStateReadError) throw e;
      throw new MandateStateReadError(
        'TURNOVER_UNAVAILABLE',
        `Receipt history or block timestamps unavailable at block ${block.number}; refusing execution`,
      );
    }
  }
  return (request: Request) => {
    const pending = queue.then(() => read(request));
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
}
const readers = new WeakMap<
  TurnoverClient,
  ReturnType<typeof createTurnoverReader>
>();
export function readCachedTurnover(client: TurnoverClient, request: Request) {
  let reader = readers.get(client);
  if (!reader) {
    reader = createTurnoverReader(client);
    readers.set(client, reader);
  }
  return reader(request);
}
