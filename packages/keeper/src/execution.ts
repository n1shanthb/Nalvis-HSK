import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  encodeFunctionData,
  decodeEventLog,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hex,
  type Account,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addresses,
  assertWritableChain,
  collectEvidence,
  policyHash,
  type EvidenceClient,
  type Policy,
  type Mandate,
} from '../../core/src/index.js';
import {
  vaultAbi,
  proofRouterAbi,
  erc20Abi,
  quoterAbi,
  receiptEvent,
  poolReadAbi,
} from '../../core/src/abi/index.js';
import {
  assertLocalAnvil,
  assertTestnetHuman,
  type Options,
  type Deployment,
} from './config.js';
import { meanTick, twapOutput } from './twap.js';
import { demoEvidence } from './demo.js';
import {
  readReceipt,
  receiptFiles,
  saveJSON,
  type Execution,
  type Snapshot,
  type Settlement,
} from './runner.js';

// PUBLIC ANVIL DEVELOPMENT KEY #2 (account index 1). Never used outside local chain 31337.
export const PUBLIC_ANVIL_MNEMONIC =
  'test test test test test test test test test test test junk';
const natural = z.bigint().nonnegative();
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const mandateRaw = z.tuple([
  addr,
  natural,
  natural,
  natural,
  natural,
  z.number().int().min(0).max(10000),
  z.number().int().min(0).max(100),
  z.number().int().min(0).max(10000),
  natural,
  hex,
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const scale = (n: bigint, from: number, to: number) =>
  (n * 10n ** BigInt(to)) / 10n ** BigInt(from);
export async function guardSigning(
  client: { getChainId(): Promise<number> },
  expected: 133 | 31337,
  env = process.env,
) {
  const actual = await client.getChainId();
  assertWritableChain(actual);
  if (actual !== expected)
    throw new Error(
      `Execution chain ${actual} differs from expected ${expected}`,
    );
  if (expected === 133) assertTestnetHuman(env);
}
export async function connectExecution(
  options: Options,
  policy: Policy,
  deployment: Deployment,
): Promise<Execution> {
  const chainId = options.exec === 'testnet' ? 133 : 31337;
  if (chainId === 133) assertTestnetHuman();
  const url =
    chainId === 133
      ? process.env.HSK_TESTNET_RPC
      : (process.env.ANVIL_RPC ?? 'http://127.0.0.1:8545');
  if (!url) throw new Error('Missing execution RPC');
  if (chainId === 31337) assertLocalAnvil(url);
  const chain = defineChain({
    id: chainId,
    name:
      chainId === 133
        ? 'HashKey testnet (prices not real)'
        : 'Local anvil fork',
    nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(url, { retryCount: 0, timeout: 15000 }),
  });
  // Check RPC-reported chain BEFORE deriving an account or constructing a wallet.
  await guardSigning(client, chainId);
  let account: Account;
  if (chainId === 31337)
    account = mnemonicToAccount(PUBLIC_ANVIL_MNEMONIC, { addressIndex: 1 });
  else {
    const key = z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .safeParse(process.env.TESTNET_AGENT_KEY);
    if (!key.success)
      throw new Error(
        'Missing/invalid runtime TESTNET_AGENT_KEY (human local only)',
      );
    account = privateKeyToAccount(key.data as Hex);
  }
  if (
    !same(account.address, deployment.agent) ||
    same(account.address, deployment.owner) ||
    same(account.address, deployment.deployer)
  )
    throw new Error(
      'Agent must match deployment and differ from owner/deployer',
    );
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(url, { retryCount: 0, timeout: 15000 }),
  });
  const config = addresses[chainId === 133 ? 133 : 177];
  const contract =
    options.target === 'vault' ? deployment.vault : deployment.router;
  const targetAbi = options.target === 'vault' ? vaultAbi : proofRouterAbi;
  const read = async (
    functionName: string,
    address: Address = deployment.vault,
    abi: typeof vaultAbi | typeof proofRouterAbi | typeof erc20Abi = vaultAbi,
    args: unknown[] = [],
    blockNumber?: bigint,
  ): Promise<unknown> =>
    client.readContract({
      address,
      abi,
      functionName,
      args,
      blockNumber,
    } as never);
  const integer = async (fn: string) => natural.parse(await read(fn));
  const readDecimals = async (token: Address) =>
    z
      .number()
      .int()
      .min(0)
      .max(36)
      .parse(await read('decimals', token, erc20Abi));
  const da = await readDecimals(config.whsk.address),
    db = await readDecimals(config.usdt.address);
  if (
    !same(addr.parse(await read('owner')), deployment.owner) ||
    !same(
      addr.parse(await read('owner', deployment.router, proofRouterAbi)),
      deployment.owner,
    )
  )
    throw new Error('Deployment owner differs from chain');
  for (const [fn, expected] of [
    ['tokenA', config.whsk.address],
    ['tokenB', config.usdt.address],
    ['pool', config.primaryPool.address],
    ['router', config.swapRouter02.address],
  ] as const) {
    if (!same(addr.parse(await read(fn)), expected))
      throw new Error(`Unverified vault ${fn}`);
  }
  if (
    !same(
      addr.parse(await read('router', deployment.router, proofRouterAbi)),
      config.swapRouter02.address,
    )
  )
    throw new Error('Unverified router destination');
  const balance = async (token: Address, holder: Address) =>
    natural.parse(await read('balanceOf', token, erc20Abi, [holder]));
  const event = parseAbiItem(receiptEvent);
  async function events() {
    const latest = await client.getBlockNumber();
    const logs: Awaited<ReturnType<typeof client.getLogs<typeof event>>> = [];
    for (let from = deployment.block; from <= latest; from += 5000n) {
      const to = from + 4999n > latest ? latest : from + 4999n;
      logs.push(
        ...(await client.getLogs({
          address: contract,
          event,
          fromBlock: from,
          toBlock: to,
        })),
      );
    }
    if (options.target === 'vault') return logs;
    const own = [];
    for (const log of logs)
      if (
        same(
          (await client.getTransaction({ hash: log.transactionHash })).from,
          account.address,
        )
      )
        own.push(log);
    return own;
  }
  let routerDailySpentB = 0n,
    routerLastTradeAt = 0;
  async function snapshot(): Promise<Snapshot> {
    await guardSigning(client, chainId);
    const block = await client.getBlock();
    const m = mandateRaw.parse(
      await read('mandate', deployment.vault, vaultAbi, [], block.number),
    );
    if (
      same(m[0], zeroAddress) ||
      !same(m[0], account.address) ||
      BigInt(block.timestamp) >= m[1]
    )
      throw new Error('Mandate revoked, expired or agent mismatch');
    if (z.boolean().parse(await read('paused')))
      throw new Error('Vault paused');
    const seq = natural.parse(
      await read(
        'seq',
        contract,
        targetAbi,
        options.target === 'router' ? [account.address] : [],
      ),
    );
    const head = hex.parse(
      await read(
        'head',
        contract,
        targetAbi,
        options.target === 'router' ? [account.address] : [],
      ),
    ) as Hex;
    if (
      options.target === 'router' &&
      !same(
        hex.parse(await read('policyHash', contract, proofRouterAbi)),
        policyHash(policy),
      )
    )
      throw new Error('Router policy mismatch');
    const holder =
      options.target === 'vault' ? deployment.vault : account.address;
    const mandate: Mandate = {
      revoked: false,
      expiry: Number(m[1]),
      maxTradeInA: scale(m[2], da, 18),
      maxTradeInB: scale(m[3], db, 6),
      maxDailyInB: scale(m[4], db, 6),
      maxExposureBps: m[5],
      maxSlippageBps: m[6],
      maxDrawdownBps: m[7],
      minIntervalSec: Number(m[8]),
      policyHash: m[9],
    };
    const now = Number(block.timestamp);
    return {
      blockNumber: block.number,
      seq,
      head,
      nonce: options.target === 'router' ? seq : await integer('nextNonce'),
      now,
      mandate,
      executionDecimalsA: da,
      executionDecimalsB: db,
      state: {
        preset: options.preset,
        balanceA: scale(await balance(config.whsk.address, holder), da, 18),
        balanceB: scale(await balance(config.usdt.address, holder), db, 6),
        lastTradeAt:
          options.target === 'router'
            ? routerLastTradeAt
            : Number(await integer('lastTradeAt')),
        dailyBucket:
          options.target === 'router'
            ? Math.floor(now / 86400)
            : Number(await integer('dailyBucket')),
        dailySpentB:
          options.target === 'router'
            ? routerDailySpentB
            : scale(await integer('dailyNotionalB'), db, 6),
        dailyLossB: 0,
        llmValid: true,
      },
    };
  }
  async function check(s: Snapshot) {
    await guardSigning(client, chainId);
    const fresh = await snapshot();
    if (
      fresh.seq !== s.seq ||
      fresh.head !== s.head ||
      fresh.nonce !== s.nonce ||
      fresh.mandate.policyHash !== s.mandate.policyHash ||
      JSON.stringify(fresh.mandate, (_, v) =>
        typeof v === 'bigint' ? String(v) : v,
      ) !==
        JSON.stringify(s.mandate, (_, v) =>
          typeof v === 'bigint' ? String(v) : v,
        )
    )
      throw new Error('Chain/mandate changed; refusing stale tick');
    const [latest, pending] = await Promise.all([
      client.getTransactionCount({
        address: account.address,
        blockTag: 'latest',
      }),
      client.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      }),
    ]);
    if (latest !== pending)
      throw new Error(
        'Agent has a pending nonce; refusing another transaction',
      );
  }
  let sendingValidUntil: number | undefined;
  async function guardedSend(to: Address, data: Hex) {
    await guardSigning(client, chainId);
    await snapshot(); // Every write, including exact approvals, requires a live mandate.
    // Explicit nonce, no transport retries and no replacement path.
    const [nonce, pending] = await Promise.all([
      client.getTransactionCount({
        address: account.address,
        blockTag: 'latest',
      }),
      client.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      }),
    ]);
    if (nonce !== pending) throw new Error('Pending wallet transaction');
    await client.call({ account: account.address, to, data });
    await guardSigning(client, chainId);
    if (
      sendingValidUntil !== undefined &&
      Number((await client.getBlock()).timestamp) > sendingValidUntil
    )
      throw new Error('Stale decision dropped before signature');
    return wallet.sendTransaction({ to, data, nonce, account, chain });
  }
  function settlement(
    tx: Awaited<ReturnType<typeof client.waitForTransactionReceipt>>,
    expectedHash?: Hex,
  ): Settlement {
    if (tx.status !== 'success')
      throw new Error('Transaction reverted; inspect pending journal');
    const logs = tx.logs
      .filter((l) => same(l.address, contract))
      .flatMap((l) => {
        try {
          const d = decodeEventLog({
            abi: targetAbi,
            data: l.data,
            topics: l.topics,
          });
          return d.eventName === 'Receipt' ? [d.args] : [];
        } catch {
          return [];
        }
      });
    if (logs.length !== 1) throw new Error('Expected exactly one Receipt log');
    const log = logs[0] as Settlement['log'];
    if (expectedHash && log.receiptHash !== expectedHash)
      throw new Error('Receipt event hash mismatch');
    return {
      transactionHash: tx.transactionHash,
      blockNumber: tx.blockNumber,
      status: 'success',
      log,
      gasUsed: tx.gasUsed,
      effectiveGasPrice: tx.effectiveGasPrice,
    };
  }
  return {
    chainId,
    contract,
    quoteAddress: config.quoterV2.address,
    snapshot,
    check,
    async collect(s) {
      if (!process.env.HSK_MAINNET_RPC)
        throw new Error('Missing read-only HSK_MAINNET_RPC');
      const marketChain = defineChain({
        id: 177,
        name: 'HashKey mainnet READ ONLY',
        nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
        rpcUrls: { default: { http: [process.env.HSK_MAINNET_RPC] } },
      });
      const market = createPublicClient({
        chain: marketChain,
        transport: http(process.env.HSK_MAINNET_RPC, {
          retryCount: 0,
          timeout: 15000,
        }),
      });
      if ((await market.getChainId()) !== 177)
        throw new Error('Market RPC must report chain 177');
      const live = await collectEvidence({
        marketClient177: market as unknown as EvidenceClient,
        execClient: client as unknown as EvidenceClient,
        vault: deployment.vault,
        sizes: policy.presets[options.preset].sizeGridB,
        decisionTtlSec: policy.decisionTtlSec ?? 120,
      });
      // Market retrieval times remain UTC wall time; execution deadlines use the chain clock.
      void s;
      return options.demo ? demoEvidence(policy, options.demo, live) : live;
    },
    async quote(direction, amountIn, snapshot) {
      const result = await client.simulateContract({
        address: config.quoterV2.address,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        blockNumber: snapshot.blockNumber,
        args: [
          {
            tokenIn:
              direction === 'BUY_A' ? config.usdt.address : config.whsk.address,
            tokenOut:
              direction === 'BUY_A' ? config.whsk.address : config.usdt.address,
            amountIn,
            fee: 3000,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      const quote = z
        .tuple([
          z.bigint().positive(),
          z.bigint().positive(),
          z.number().int().nonnegative(),
          natural,
        ])
        .parse(result.result)[0];
      let floor = 0n;
      if (options.target === 'vault') {
        const window = z
          .number()
          .int()
          .positive()
          .parse(await read('twapWindowSec'));
        const observed = await client.readContract({
          address: config.primaryPool.address,
          abi: poolReadAbi,
          functionName: 'observe',
          blockNumber: snapshot.blockNumber,
          args: [[window, 0]],
        });
        const ticks = z.array(z.bigint()).length(2).parse(observed[0]);
        const tokenIn =
          direction === 'BUY_A' ? config.usdt.address : config.whsk.address;
        const tokenOut =
          direction === 'BUY_A' ? config.whsk.address : config.usdt.address;
        const ref = twapOutput(
          meanTick(ticks[0], ticks[1], window),
          amountIn,
          BigInt(tokenIn) < BigInt(tokenOut),
        );
        floor =
          (ref * BigInt(10000 - snapshot.mandate.maxSlippageBps)) / 10000n;
      }
      return { quote, floor };
    },
    calldata(r) {
      const kind = ['TRADE', 'RESIZE', 'WAIT', 'REJECT'].indexOf(
        r.decision.kind,
      );
      if (kind >= 2)
        return encodeFunctionData({
          abi: targetAbi,
          functionName: 'commitHold',
          args: [r.receiptHash, r.prevHead, kind],
        });
      const quote = r.evidence.sources.executionQuote?.raw as {
        amountIn: bigint;
      };
      const buy = r.decision.direction === 'BUY_A',
        tokenIn = buy ? config.usdt.address : config.whsk.address;
      if (options.target === 'vault')
        return encodeFunctionData({
          abi: vaultAbi,
          functionName: 'trade',
          args: [
            {
              tokenIn,
              amountIn: quote.amountIn,
              minOut: r.tx.minOut,
              deadline: BigInt(r.tx.deadline),
              validUntil: BigInt(
                r.tx.validUntil ??
                  (() => {
                    throw new Error('Missing decision expiry');
                  })(),
              ),
              nonce: r.tx.nonce,
              receiptHash: r.receiptHash,
              prevHead: r.prevHead,
              kind,
            },
          ],
        });
      return encodeFunctionData({
        abi: proofRouterAbi,
        functionName: 'commitAndSwap',
        args: [
          r.receiptHash,
          r.prevHead,
          {
            tokenIn,
            tokenOut: buy ? config.whsk.address : config.usdt.address,
            fee: 3000,
            recipient: account.address,
            amountIn: quote.amountIn,
            amountOutMinimum: r.tx.minOut,
            sqrtPriceLimitX96: 0n,
          },
          BigInt(
            r.tx.validUntil ??
              (() => {
                throw new Error('Missing decision expiry');
              })(),
          ),
          BigInt(r.tx.deadline),
        ],
      });
    },
    async send(data, onHash, validUntil) {
      if (!Number.isSafeInteger(validUntil) || validUntil < 0)
        throw new Error('Missing decision expiry');
      const { decodeFunctionData } = await import('viem');
      const parsed = decodeFunctionData({
        abi: [...vaultAbi, ...proofRouterAbi],
        data,
      });
      sendingValidUntil =
        parsed.functionName === 'trade'
          ? Number(parsed.args[0].validUntil)
          : parsed.functionName === 'commitAndSwap'
            ? Number(parsed.args[3])
            : validUntil;
      if (sendingValidUntil !== validUntil)
        throw new Error('Decision/calldata expiry mismatch');
      // Router approvals are exact and cleared. The intent journal already exists before this first write.
      let token: Address | undefined;
      if (options.target === 'router') {
        const { decodeFunctionData } = await import('viem');
        const call = decodeFunctionData({ abi: proofRouterAbi, data });
        if (call.functionName === 'commitAndSwap') {
          token = call.args[2].tokenIn;
          if (
            natural.parse(
              await read('allowance', token, erc20Abi, [
                account.address,
                contract,
              ]),
            ) !== 0n
          )
            throw new Error(
              'Router allowance must start at zero; inspect previous pending intent',
            );
          const approval = await guardedSend(
            token,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [contract, call.args[2].amountIn],
            }),
          );
          const mined = await client.waitForTransactionReceipt({
            hash: approval,
            timeout: 60000,
          });
          if (mined.status !== 'success')
            throw new Error('Exact approval reverted');
        }
      }
      const hash = await guardedSend(contract, data);
      await onHash(hash);
      const mined = await client.waitForTransactionReceipt({
        hash,
        timeout: 60000,
      });
      if (token) {
        const reset = await guardedSend(
          token,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [contract, 0n],
          }),
        );
        if (
          (
            await client.waitForTransactionReceipt({
              hash: reset,
              timeout: 60000,
            })
          ).status !== 'success'
        )
          throw new Error('Allowance reset failed');
        if (
          natural.parse(
            await read('allowance', token, erc20Abi, [
              account.address,
              contract,
            ]),
          ) !== 0n
        )
          throw new Error('Residual router allowance');
      }
      return settlement(mined);
    },
    async reconcile(directory) {
      const files = await receiptFiles(directory);
      const logs = await events();
      const chainNow = Number((await client.getBlock()).timestamp);
      const day = Math.floor(chainNow / 86400);
      let loss = 0;
      routerDailySpentB = 0n;
      routerLastTradeAt = 0;
      // Hash matches JSON, settlement comes from chain, and sequence/head links stay authoritative.
      const receipts = await Promise.all(
        files.map(async (f) => ({
          path: join(directory, f),
          r: await readReceipt(join(directory, f)),
        })),
      );
      for (const log of logs) {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        const today = Math.floor(Number(block.timestamp) / 86400) === day;
        const known = receipts.find(
          ({ r }) =>
            same(r.contract, contract) &&
            r.receiptHash === log.args.receiptHash,
        );
        if (!known) {
          if (today)
            throw new Error(
              'Unknown on-chain receipt today; cannot reconstruct loss stop safely',
            );
          continue;
        }
        if (!today && known.r.settlement) continue;
        const tx = await client.getTransactionReceipt({
          hash: log.transactionHash,
        });
        const actual = settlement(tx, known.r.receiptHash);
        await saveJSON(known.path, { ...known.r, settlement: actual });
        if (!today) continue;
        // Missing valuation data fails closed rather than disabling the daily loss stop.
        const mid = z.number().positive().parse(known.r.evidence.dexMid);
        const a = actual.log;
        if (a.amountIn > 0n) {
          const buy = same(a.tokenIn, config.usdt.address);
          const inputB =
            (Number(a.amountIn) / 10 ** (buy ? db : da)) * (buy ? 1 : mid);
          const outputB =
            (Number(a.amountOut) / 10 ** (buy ? da : db)) * (buy ? mid : 1);
          loss += Math.max(0, inputB - outputB);
          routerDailySpentB += BigInt(Math.ceil(inputB * 1e6));
          routerLastTradeAt = Math.max(
            routerLastTradeAt,
            Number(block.timestamp),
          );
        }
        loss +=
          (Number(actual.gasUsed * actual.effectiveGasPrice) / 1e18) * mid;
      }
      const pendingPath = join(directory, '.pending.json');
      let pending;
      try {
        pending = JSON.parse(await readFile(pendingPath, 'utf8'));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (pending) {
        const log = logs.find(
          (l) => l.args.receiptHash === pending.receiptHash,
        );
        if (!log)
          throw new Error(
            'Unresolved transaction intent; inspect nonce/chain before manual recovery. No resend.',
          );
        await unlink(pendingPath);
      }
      return loss;
    },
  };
}
