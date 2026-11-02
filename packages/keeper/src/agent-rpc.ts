import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  decodeEventLog,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertMainnetActivation } from './mainnet-guard.js';
import {
  hash,
  addresses,
  assertWritableChain,
  collectEvidence,
  type EvidenceClient,
} from '../../core/src/index.js';
import { vaultAbi, quoterAbi, receiptEvent } from '../../core/src/abi/index.js';
import {
  readMandateState,
  amountFor,
  calldata,
  simulate,
  executionReceiptSchema,
  ownerReceiptHash,
  mandateStateSchema,
  type AgentClients,
  type Store,
  type Journal,
  type EvidenceLite,
} from '../../core/src/agent/index.js';
import {
  assertLocalAnvil,
  assertTestnetHuman,
  loadDeployment,
  repositoryRoot,
} from './config.js';
import { assertSellAuthorization } from '../../core/src/copilot.js';
import { matchesConfirmedSell } from '../../core/src/agent/owner-preview.js';
export class PreflightError extends Error {
  constructor(
    readonly state: 'offline' | 'needs_owner',
    readonly reason: string,
  ) {
    super(reason);
  }
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export async function connectAgentRpc(
  exec: 'testnet' | 'anvil' | 'mainnet',
  store: Store,
  env = process.env,
) {
  const expected = exec === 'mainnet' ? 177 : exec === 'testnet' ? 133 : 31337;
  const url =
    exec === 'mainnet'
      ? env.HSK_MAINNET_RPC
      : exec === 'testnet'
        ? env.HSK_TESTNET_RPC
        : (env.ANVIL_RPC ?? 'http://127.0.0.1:8545');
  if (!url) throw new PreflightError('offline', 'HSK_TESTNET_RPC missing');
  if (expected === 31337) assertLocalAnvil(url);
  const chain = defineChain({
    id: expected,
    name:
      expected === 177
        ? 'HashKey mainnet — real funds'
        : 'Agent execution sandbox',
    nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(url, { retryCount: 0, timeout: 15000 }),
    cacheTime: 0,
  });
  const guard = async () => {
    const actual = await client.getChainId();
    if (actual === 177 && expected === 177) assertMainnetActivation(env);
    else assertWritableChain(actual);
    if (actual !== expected)
      throw new PreflightError('offline', 'Execution chain mismatch');
    if (expected === 133) assertTestnetHuman(env);
  };
  if (!env.AGENT_PRIVATE_KEY)
    throw new PreflightError('offline', 'AGENT_PRIVATE_KEY missing');
  if (!/^0x[\da-fA-F]{64}$/.test(env.AGENT_PRIVATE_KEY))
    throw new PreflightError('offline', 'AGENT_PRIVATE_KEY invalid');
  await guard(); // Before deriving the signer, including the OFFLINE path.
  const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY as Hex);
  const deployment = loadDeployment(
    expected,
    env.AGENT_DEPLOYMENT,
    expected === 177,
  );
  if (expected === 177 && deployment.commit !== env.MAINNET_DEPLOY_COMMIT)
    throw new PreflightError(
      'needs_owner',
      'Reviewed deployment commit mismatch',
    );
  if (
    !same(account.address, deployment.agent) ||
    same(account.address, deployment.owner) ||
    same(account.address, deployment.deployer)
  )
    throw new PreflightError(
      'needs_owner',
      'Signer and deployment roles mismatch',
    );
  const vault = deployment.vault;
  if (env.VAULT_ADDRESS && !same(env.VAULT_ADDRESS, vault))
    throw new PreflightError(
      'needs_owner',
      'VAULT_ADDRESS differs from manifest',
    );
  if (expected === 133 || expected === 177) {
    const registry = (
      await readFile(join(repositoryRoot(), 'docs/ADDRESSES.md'), 'utf8')
    ).toLowerCase();
    if (
      !registry.includes(vault.toLowerCase()) ||
      !registry.includes(deployment.router.toLowerCase())
    )
      throw new PreflightError(
        'needs_owner',
        'Deployment missing from docs/ADDRESSES.md',
      );
  }
  const code = await client.getCode({ address: vault });
  if (!code || code === '0x')
    throw new PreflightError('needs_owner', 'Vault code missing');
  const owner = await client.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'owner',
  });
  if (!same(owner, deployment.owner))
    throw new PreflightError('needs_owner', 'Vault owner mismatch');
  const wallet = createWalletClient({
    chain,
    account,
    transport: http(url, { retryCount: 0, timeout: 15000 }),
  });
  const marketUrl = env.HSK_MAINNET_RPC;
  if (!marketUrl)
    throw new PreflightError('offline', 'HSK_MAINNET_RPC missing');
  const marketChain = defineChain({
    id: 177,
    name: 'HashKey READ ONLY',
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [marketUrl] } },
  });
  const market = createPublicClient({
    chain: marketChain,
    transport: http(marketUrl, { retryCount: 0, timeout: 15000 }),
  });
  if ((await market.getChainId()) !== 177)
    throw new PreflightError('offline', 'Market RPC must be 177 read-only');
  const network = addresses[expected === 133 ? 133 : 177];
  if (expected === 133 || expected === 177)
    for (const [fn, address] of [
      ['tokenA', network.whsk.address],
      ['tokenB', network.usdt.address],
      ['pool', network.primaryPool.address],
      ['router', network.swapRouter02.address],
    ] as const) {
      if (
        !same(
          await client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: fn,
          }),
          address,
        )
      )
        throw new PreflightError(
          'needs_owner',
          'Unverified vault configuration',
        );
    }
  const readState = () =>
    readMandateState(client, vault, undefined, account.address);
  const collect = async (sizes: number[]) => {
    if ((await market.getChainId()) !== 177)
      throw Error('Market chain mismatch');
    return collectEvidence({
      marketClient177: market as unknown as EvidenceClient,
      execClient: client as unknown as EvidenceClient,
      sizes,
      decisionTtlSec: 120,
    });
  };
  const ownerAbi = parseAbi([
    'event MandateSet((address agent,uint256 expiry,uint256 maxTradeInA,uint256 maxTradeInB,uint256 maxDailyInB,uint16 maxExposureBps,uint16 maxSlippageBps,uint16 maxDrawdownBps,uint256 minIntervalSec,bytes32 policyHash) mandate)',
    'event Paused(bool paused)',
    'event Revoked()',
  ]);
  // Persist only acknowledged ranges. A crash may replay events; core deduplicates their IDs.
  const ownerEvents = async (): Promise<
    NonNullable<EvidenceLite['ownerEvents']>
  > => {
    const cursor = await store.read<{ block: string; hash: Hex }>(
      'owner-cursor.json',
    );
    const latest = await client.getBlock();
    let from = deployment.block;
    if (cursor) {
      const old = await client.getBlock({ blockNumber: BigInt(cursor.block) });
      if (old.hash === cursor.hash) from = BigInt(cursor.block) + 1n;
    }
    const rows: NonNullable<EvidenceLite['ownerEvents']> = [];
    for (; from <= latest.number; from += 5000n) {
      const logs = await client.getLogs({
        address: vault,
        events: ownerAbi,
        fromBlock: from,
        toBlock: from + 4999n < latest.number ? from + 4999n : latest.number,
      });
      for (const log of logs)
        rows.push({
          id: `${log.blockHash}:${log.logIndex}`,
          block: Number(log.blockNumber),
          name:
            log.eventName === 'Paused'
              ? log.args.paused
                ? 'Paused'
                : 'Unpaused'
              : (log.eventName as 'MandateSet' | 'Revoked'),
        });
    }
    // Persist event queue before advancing cursor, so no owner event is lost.
    const acknowledged =
      (await store.read<{ ownerEvents?: string[] }>('runtime.json'))
        ?.ownerEvents ?? [];
    await store.write('owner-events.json', [
      ...((await store.read<typeof rows>('owner-events.json')) ?? []).filter(
        (e) => !acknowledged.includes(e.id),
      ),
      ...rows,
    ]);
    await store.write('owner-cursor.json', {
      block: String(latest.number),
      hash: latest.hash,
    });
    return (await store.read<typeof rows>('owner-events.json')) ?? [];
  };
  const clients: AgentClients = {
    readState,
    durableBroadcastMarker: true,
    readOwner: (blockNumber) =>
      client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: 'owner',
        ...(blockNumber === undefined ? {} : { blockNumber }),
      }),
    async evidenceLite() {
      const [e, events] = await Promise.all([collect([]), ownerEvents()]);
      const cex = e.cex.length
        ? e.cex.reduce((n, c) => n + (c.bid + c.ask) / 2, 0) / e.cex.length
        : undefined;
      const swapsRaw = e.sources.subgraph?.raw;
      const swaps = z
        .object({
          data: z.object({
            v3Swaps: z.array(
              z.object({
                timestamp: z.string().regex(/^\d+$/),
                amountUSD: z.string(),
              }),
            ),
          }),
        })
        .safeParse(swapsRaw);
      return {
        prices: {
          ...(e.dexMid ? { dex: String(e.dexMid) } : {}),
          ...(cex ? { cex: String(cex) } : {}),
          ...(e.apro ? { apro: String(e.apro.price) } : {}),
        },
        ...(e.sources.liquidity?.raw
          ? { liquidity: String(e.sources.liquidity.raw) }
          : {}),
        ...(swaps.success
          ? {
              swaps: swaps.data.data.v3Swaps
                .map((s) => ({
                  at: Number(s.timestamp),
                  usd: Number(s.amountUSD),
                }))
                .filter((s) => Number.isFinite(s.usd)),
            }
          : {}),
        ownerEvents: events,
      };
    },
    collectEvidence: () =>
      collect(expected === 177 ? [0.1, 0.5, 1] : [10, 25, 50, 100, 200]),
    async quote(action, state) {
      const amountIn = amountFor(action, state),
        buy = action.type === 'BUY';
      const q = await client.simulateContract({
        address: network.quoterV2.address,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        blockNumber: state.block,
        args: [
          {
            tokenIn: buy ? state.tokenB : state.tokenA,
            tokenOut: buy ? state.tokenA : state.tokenB,
            amountIn,
            fee: 3000,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      return {
        block: state.block,
        at: state.blockTime,
        amountIn,
        amountOut: q.result[0],
      };
    },
    simulate: (s, p, h) => simulate(client, s, p, h),
    async send(receipt) {
      await guard();
      const s = await readState();
      if (receipt.version === 4) {
        if (
          ownerReceiptHash(receipt) !== receipt.receiptHash ||
          receipt.intent.type !== (receipt.authorization.order.direction ?? 'SELL') ||
          receipt.intent.notionalB !== receipt.authorization.order.notionalB ||
          !matchesConfirmedSell(
            receipt.authorization.order,
            receipt.final,
            receipt.seq,
          )
        )
          throw Error('Receipt differs from the exact owner confirmation');
        await assertSellAuthorization(receipt.authorization, {
          owner: await client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: 'owner',
            blockNumber: s.block,
          }),
          vault,
          chainId: expected,
          policyHash: s.mandate.policyHash,
          now: s.blockTime,
        });
      }
      if (s.chainId !== expected || receipt.executionChainId !== expected)
        throw Error('Receipt execution chain mismatch');
      const committed = mandateStateSchema.parse(
        await store.read(`states/${receipt.mandateCheck.stateHash}.json`),
      );
      if (hash(s.mandate) !== hash(committed.mandate))
        throw Error('Mandate changed before signing');
      if (
        s.head !== receipt.prevHead ||
        s.nextNonce !== receipt.final.nonce ||
        s.seq !== receipt.seq ||
        s.mandate.policyHash !== receipt.policyHash ||
        s.paused ||
        s.revoked ||
        s.mandate.expiry <= BigInt(s.blockTime) ||
        !same(s.mandate.agent, account.address)
      )
        throw Error('Final authorization changed');
      const latest = await client.getTransactionCount({
        address: account.address,
        blockTag: 'latest',
      });
      if (
        latest !==
        (await client.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        }))
      )
        throw Error('Wallet has pending transaction');
      const data = calldata(receipt.final, receipt.receiptHash);
      if (!(await simulate(client, s, receipt.final, receipt.receiptHash)).ok)
        throw Error('Final simulation failed');
      const request = await wallet.prepareTransactionRequest({
        account,
        to: vault,
        data,
        nonce: latest,
      });
      await guard();
      const raw = await wallet.signTransaction(request);
      const transactionHash = keccak256(raw);
      // Persist the known hash BEFORE broadcast; an ambiguous transport failure is never resent.
      await store.write('.pending.json', {
        receiptHash: receipt.receiptHash,
        transactionHash,
        walletNonce: latest,
      });
      await guard();
      await client.sendRawTransaction({ serializedTransaction: raw });
      const mined = await client.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: 120000,
      });
      if (mined.status !== 'success')
        throw Error('Transaction reverted; inspect pending intent');
      return { transactionHash };
    },
  };
  async function reconcile(journal: Journal) {
    const pending = await store.read<{ receiptHash: Hex }>('pending.json');
    if (!pending) {
      await store.write('.pending.json', null);
      return;
    }
    const r = executionReceiptSchema.parse(
      await store.read(`receipts/${pending.receiptHash}.json`),
    );
    const marker = await store.read<{ transactionHash: Hex }>('.pending.json');
    let transactionHash =
      r.settlement?.transactionHash ?? marker?.transactionHash;
    if (!transactionHash) {
      const end = await client.getBlockNumber();
      for (let from = deployment.block; from <= end; from += 5000n) {
        const logs = await client.getLogs({
          address: vault,
          event: parseAbiItem(receiptEvent),
          args: { receiptHash: r.receiptHash },
          fromBlock: from,
          toBlock: from + 4999n < end ? from + 4999n : end,
        });
        if (logs.length) transactionHash = logs[0].transactionHash;
      }
    }
    if (!transactionHash)
      throw new PreflightError(
        'needs_owner',
        'Unresolved pending intent; inspect wallet nonce, never resend',
      );
    const mined = await client.getTransactionReceipt({ hash: transactionHash });
    const tx = await client.getTransaction({ hash: transactionHash });
    const matched = mined.logs.some((l) => {
      try {
        const d = decodeEventLog({
          abi: vaultAbi,
          data: l.data,
          topics: l.topics,
        });
        return (
          same(l.address, vault) &&
          d.eventName === 'Receipt' &&
          d.args.receiptHash === r.receiptHash &&
          d.args.seq === r.seq
        );
      } catch {
        return false;
      }
    });
    if (
      mined.status !== 'success' ||
      !matched ||
      !same(tx.from, account.address) ||
      !tx.to ||
      !same(tx.to, vault) ||
      tx.input !== calldata(r.final, r.receiptHash)
    )
      throw new PreflightError(
        'needs_owner',
        'Pending settlement does not match intent',
      );
    if (
      (await client.getTransactionCount({
        address: account.address,
        blockTag: 'latest',
      })) !==
      (await client.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      }))
    )
      throw new PreflightError('needs_owner', 'Wallet still pending');
    await store.write(`receipts/${r.receiptHash}.json`, {
      ...r,
      settlement: { transactionHash },
    });
    if (
      !journal.entries.some(
        (e) => e.type === 'ACTION' && e.data.receiptHash === r.receiptHash,
      )
    )
      await journal.append(
        'ACTION',
        {
          kind: r.final.kind,
          amountIn: String(r.final.amountIn),
          minOut: String(r.final.minOut),
          transactionHash,
          txHash: transactionHash,
          receiptHash: r.receiptHash,
          recovered: true,
        },
        Math.floor(Date.now() / 1000),
      );
    const runtime =
      (await store.read<Record<string, unknown>>('runtime.json')) ?? {};
    await store.write('runtime.json', {
      ...runtime,
      journalFrom: r.journalHead,
      lastAnchor: Math.floor(Date.now() / 1000),
    });
    await store.write('pending.json', null);
    await store.write('.pending.json', null);
  }
  return { clients, reconcile };
}
