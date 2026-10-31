import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  zeroAddress,
  parseAbi,
  type Address,
  type Abi,
  type Hex,
} from 'viem';
import { anvil } from 'viem/chains';
import {
  readMandateState,
  simulate,
  calldata,
  amountFor,
  type MandateState,
  type ExecQuote,
} from '../../src/agent/mandate-check.js';
import type { Action } from '../../src/agent/schema.js';
export const anvilBin = process.env.ANVIL_BIN ?? 'anvil';
export const hasAnvil = spawnSync(anvilBin, ['--version']).status === 0;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export async function localVault() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  const proc = spawn(
    anvilBin,
    ['--port', String(port), '--chain-id', '31337', '--silent'],
    { stdio: 'ignore' },
  );
  const url = `http://127.0.0.1:${port}`,
    client = createPublicClient({
      chain: anvil,
      transport: http(url, { retryCount: 0 }),
      cacheTime: 0,
    });
  for (let i = 0; i < 100; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  const wallet = createWalletClient({
    chain: anvil,
    transport: http(url, { retryCount: 0 }),
  });
  const accounts = await wallet.getAddresses();
  const owner = accounts[0],
    agent = accounts[1],
    deployer = accounts[2];
  const artifact = async (name: string) =>
    JSON.parse(
      await readFile(`${root}contracts/out/${name}.sol/${name}.json`, 'utf8'),
    ) as { abi: Abi; bytecode: { object: Hex } };
  const deploy = async (name: string, args: unknown[] = []) => {
    const a = await artifact(name);
    const tx = await wallet.deployContract({
      account: deployer,
      abi: a.abi,
      bytecode: a.bytecode.object,
      args,
    });
    const mined = await client.waitForTransactionReceipt({ hash: tx });
    return { address: mined.contractAddress!, abi: a.abi };
  };
  const tokenA = await deploy('MockERC20', [18]),
    tokenB = await deploy('MockERC20', [18]),
    pool = await deploy('MockPool', [tokenA.address, tokenB.address]),
    router = await deploy('MockRouter');
  const vault = await deploy('EdgewiseVault', [
    owner,
    router.address,
    pool.address,
    tokenA.address,
    tokenB.address,
    3000,
    600,
    zeroAddress,
    0,
    0,
  ]);
  async function write(
    target: { address: Address; abi: Abi },
    functionName: string,
    args: unknown[] = [],
    account = owner,
  ) {
    const tx = await wallet.writeContract({
      ...target,
      functionName,
      args,
      account,
    });
    return client.waitForTransactionReceipt({ hash: tx });
  }
  const unit = 10n ** 18n;
  for (const token of [tokenA, tokenB]) {
    await write(token, 'mint', [vault.address, 1000n * unit]);
    await write(token, 'mint', [router.address, 1000000n * unit]);
  }
  const now = Number((await client.getBlock()).timestamp);
  const mandate = {
    agent,
    expiry: BigInt(now + 30 * 86400),
    maxTradeInA: 100n * unit,
    maxTradeInB: 100n * unit,
    maxDailyInB: 1000n * unit,
    maxExposureBps: 10000,
    maxSlippageBps: 100,
    maxDrawdownBps: 0,
    minIntervalSec: 300n,
    policyHash: ('0x' + '1'.repeat(64)) as Hex,
  };
  await write(vault, 'setMandate', [mandate]);
  const rpc = (method: string, params: unknown[] = []) =>
    client.request({ method, params } as never);
  return {
    client,
    wallet,
    owner,
    agent,
    tokenA,
    tokenB,
    pool,
    router,
    vault,
    write,
    mandate,
    url,
    rpc,
    state: () => readMandateState(client, vault.address, undefined, agent),
    async quote(a: Action, s: MandateState): Promise<ExecQuote> {
      const n = amountFor(a, s);
      const num = (await client.readContract({
          ...router,
          functionName: 'numerator',
        })) as bigint,
        den = (await client.readContract({
          ...router,
          functionName: 'denominator',
        })) as bigint;
      return {
        block: s.block,
        at: s.blockTime,
        amountIn: n,
        amountOut: (n * num) / den,
      };
    },
    simulate: (s: MandateState, p: Parameters<typeof simulate>[2], h?: Hex) =>
      simulate(client, s, p, h),
    async send(r: import('../../src/agent/receipt.js').ReceiptV3) {
      if ((await client.getChainId()) !== 31337)
        throw Error('Local test chain only');
      const data = calldata(r.final, r.receiptHash);
      await client.call({ account: agent, to: vault.address, data });
      const tx = await wallet.sendTransaction({
        account: agent,
        to: vault.address,
        data,
      });
      const mined = await client.waitForTransactionReceipt({ hash: tx });
      if (mined.status !== 'success') throw Error('Reverted');
      return { transactionHash: tx };
    },
    async advance(seconds: number) {
      await rpc('evm_increaseTime', [seconds]);
      await rpc('evm_mine');
    },
    async stop() {
      proc.kill('SIGTERM');
      await new Promise<void>((r) => proc.once('exit', () => r()));
    },
    poolAbi: parseAbi([
      'function setTick(int24,int56)',
      'function setFail(bool)',
    ]),
  };
}
