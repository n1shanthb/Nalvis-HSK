import { pathToFileURL } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createPublicClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
} from 'viem';
import { addresses } from '../../core/src/addresses.js';
import {
  configFromEnv,
  createAgentPolicy,
  agentPolicyHash,
} from '../../core/src/agent/policy.js';
import { canonical } from '../../core/src/canonical.js';
import { repositoryRoot } from './config.js';
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export function fundingPlan(input: {
  sqrtPriceX96: bigint;
  token0: Address;
  decimalsA: number;
  decimalsB: number;
  balanceB?: bigint;
  balanceA?: bigint;
  vaultA?: bigint;
  vaultB?: bigint;
  now: number;
}) {
  const a = addresses[133],
    unitA = 10n ** BigInt(input.decimalsA),
    unitB = 10n ** BigInt(input.decimalsB),
    square = input.sqrtPriceX96 ** 2n,
    q192 = 2n ** 192n;
  if (square <= 0n) throw Error('Execution pool price unavailable');
  const priceB =
    input.token0.toLowerCase() === a.whsk.address.toLowerCase()
      ? (square * unitA) / q192
      : input.token0.toLowerCase() === a.usdt.address.toLowerCase()
        ? (q192 * unitA) / square
        : 0n;
  if (priceB <= 0n) throw Error('Unexpected pool token0 or zero price');
  const missingB =
    60n * unitB > (input.balanceB ?? 0n)
      ? 60n * unitB - (input.balanceB ?? 0n)
      : 0n;
  const swapIn = ceil(missingB * unitA * 103n, priceB * 100n); // Buffer; an actual quote must still satisfy the target.
  const vaultNeedA =
    unitA / 2n > (input.vaultA ?? 0n) ? unitA / 2n - (input.vaultA ?? 0n) : 0n;
  const vaultNeedB =
    50n * unitB > (input.vaultB ?? 0n)
      ? 50n * unitB - (input.vaultB ?? 0n)
      : 0n;
  const wrap =
    swapIn + vaultNeedA > (input.balanceA ?? 0n)
      ? swapIn + vaultNeedA - (input.balanceA ?? 0n)
      : 0n;
  const mandate = {
    maxTradeInA: ceil(25n * unitB * unitA * 12n, priceB * 10n),
    maxTradeInB: 25n * unitB,
    maxDailyInB: 200n * unitB,
    maxExposureBps: 8000,
    maxSlippageBps: 100,
    maxDrawdownBps: 2000,
    minIntervalSec: 300,
    expiry: input.now + 7 * 86400,
  };
  return {
    chainId: 133,
    priceB,
    execPrice: formatUnits(priceB, input.decimalsB),
    decimalsA: input.decimalsA,
    decimalsB: input.decimalsB,
    wrap,
    swapIn,
    missingB,
    vaultNeedA,
    vaultNeedB,
    mandate,
    human: {
      maxTradeInA:
        formatUnits(mandate.maxTradeInA, input.decimalsA) + ' WHSK per trade',
      maxTradeInB: '25 test USDT per trade',
      maxDailyInB: '200 test USDT per rolling 24 hours',
      maxExposureBps: '80% exposure',
      maxSlippageBps: '100 bps (1%) slippage',
      maxDrawdownBps: '20% drawdown',
      minIntervalSec: '300 seconds',
      expiry: new Date(mandate.expiry * 1000).toISOString() + ' (7 days)',
    },
  };
}
const abi = parseAbi([
  'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function token0() view returns(address)',
  'function decimals() view returns(uint8)',
  'function balanceOf(address) view returns(uint256)',
]);
export async function setupPlan(writePolicy = false, env = process.env) {
  if (!env.HSK_TESTNET_RPC) throw Error('HSK_TESTNET_RPC required');
  const client = createPublicClient({
    transport: http(env.HSK_TESTNET_RPC, { retryCount: 0, timeout: 15000 }),
  });
  if ((await client.getChainId()) !== 133)
    throw Error('Setup requires chain 133 even in dry-run');
  const a = addresses[133];
  const [slot, token0, da, db, b] = await Promise.all([
    client.readContract({
      address: a.primaryPool.address,
      abi,
      functionName: 'slot0',
    }),
    client.readContract({
      address: a.primaryPool.address,
      abi,
      functionName: 'token0',
    }),
    client.readContract({
      address: a.whsk.address,
      abi,
      functionName: 'decimals',
    }),
    client.readContract({
      address: a.usdt.address,
      abi,
      functionName: 'decimals',
    }),
    client.getBlock(),
  ]);
  const balance = (token: Address, holder?: string) =>
    holder
      ? client.readContract({
          address: token,
          abi,
          functionName: 'balanceOf',
          args: [holder as Address],
        })
      : Promise.resolve(0n);
  const [balanceA, balanceB, vaultA, vaultB] = await Promise.all([
    balance(a.whsk.address, env.DEPLOYER_ADDRESS),
    balance(a.usdt.address, env.DEPLOYER_ADDRESS),
    balance(a.whsk.address, env.VAULT_ADDRESS),
    balance(a.usdt.address, env.VAULT_ADDRESS),
  ]);
  const plan = fundingPlan({
    sqrtPriceX96: slot[0],
    token0,
    decimalsA: da,
    decimalsB: db,
    balanceA,
    balanceB,
    vaultA,
    vaultB,
    now: Number(b.timestamp),
  });
  if (writePolicy) {
    if (!env.STRATEGIST_MODEL || !env.FITTER_MODEL)
      throw Error('STRATEGIST_MODEL and FITTER_MODEL required');
    const config = configFromEnv('', env),
      policy = createAgentPolicy(config, { mandate: plan.mandate });
    await mkdir(join(repositoryRoot(), 'policy'), { recursive: true });
    await writeFile(join(repositoryRoot(), 'policy/agent-v3.json'), policy, {
      mode: 0o600,
    });
    return { ...plan, policyHash: agentPolicyHash(policy) };
  }
  return plan;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  setupPlan(process.argv.slice(2).includes('--policy'))
    .then((p) => console.log(canonical(p)))
    .catch(() => {
      console.error(
        'Setup plan failed: check RPC chain 133, verified pool and required env names.',
      );
      process.exitCode = 1;
    });
