import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  type Transport,
  type Chain,
} from 'viem';
import { z } from 'zod';
import { addresses } from '../../../../packages/core/src/addresses.js';
import {
  hskMainnet,
  hskTestnet,
} from '../../../../packages/core/src/chains.js';
import {
  vaultAbi,
  proofRouterAbi,
  erc20Abi,
} from '../../../../packages/core/src/abi/index.js';
import addressBook from '../../../../docs/ADDRESSES.md?raw';

export type DashboardChain = 133 | 177 | 31337;
export const clientFor = (id: DashboardChain): PublicClient<Transport, Chain> =>
  createPublicClient({
    chain:
      id === 177
        ? hskMainnet
        : id === 133
          ? hskTestnet
          : {
              ...hskMainnet,
              id: 31337,
              name: 'Local Anvil',
              rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
            },
    transport: http(undefined, { timeout: 15000, retryCount: 0 }),
  });
export const explorerLink = (
  chain: number,
  kind: 'address' | 'tx',
  value: string,
) => {
  const root =
    chain === 133
      ? hskTestnet.blockExplorers?.default.url
      : chain === 177
        ? hskMainnet.blockExplorers?.default.url
        : undefined;
  return root ? `${root}/${kind}/${value}` : undefined;
};
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v as Address);
const deploymentSchema = z.object({
  vault: address,
  router: address,
  block: z.coerce.bigint().nonnegative(),
  owner: address,
  agent: address,
  deployer: address,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
});
export type Deployment = z.infer<typeof deploymentSchema>;
export async function readJSON(path: string): Promise<unknown> {
  const response = await fetch(path, { signal: AbortSignal.timeout(15000) });
  if (
    !response.ok ||
    !(response.headers.get('content-type') ?? '').includes('json')
  )
    throw Error(`Unavailable: ${path}`);
  return response.json();
}
export async function loadDeployment(
  chain: DashboardChain,
): Promise<Deployment> {
  const deployment = deploymentSchema.parse(
    await readJSON(`/deployments/${chain}.json`),
  );
  const documented = new Set(
    (addressBook.match(/0x[0-9a-fA-F]{40}/g) ?? []).map((v) => v.toLowerCase()),
  );
  for (const contract of [deployment.vault, deployment.router]) {
    if (!documented.has(contract.toLowerCase()))
      throw Error(
        'UNVERIFIED deployment: add a verified entry to docs/ADDRESSES.md first',
      );
  }
  return deployment;
}
export type VaultMandate = {
  agent: Address;
  expiry: bigint;
  maxTradeInA: bigint;
  maxTradeInB: bigint;
  maxDailyInB: bigint;
  maxExposureBps: number;
  maxSlippageBps: number;
  maxDrawdownBps: number;
  minIntervalSec: bigint;
  policyHash: `0x${string}`;
};
export type VaultSnapshot = {
  mandate: VaultMandate;
  owner: Address;
  pendingOwner: Address;
  routerOwner: Address;
  routerPendingOwner: Address;
  routerPolicyHash: `0x${string}`;
  policiesMatch: boolean;
  paused: boolean;
  decimalsA: number;
  decimalsB: number;
  blockNumber: bigint;
};
export async function readVault(
  chain: DashboardChain,
  vault: Address,
  router: Address,
  client: PublicClient<Transport, Chain> = clientFor(chain),
): Promise<VaultSnapshot> {
  if ((await client.getChainId()) !== chain) throw Error('RPC chain mismatch');
  const blockNumber = await client.getBlockNumber();
  const read = <
    F extends 'owner' | 'pendingOwner' | 'paused' | 'mandate',
  >(functionName: F) =>
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName,
      blockNumber,
    });
  const [owner, pendingOwner, paused, raw, routerOwner, routerPendingOwner, routerPolicyHash] =
    await Promise.all([
    read('owner'),
    read('pendingOwner'),
    read('paused'),
    read('mandate'),
    client.readContract({
      address: router,
      abi: proofRouterAbi,
      functionName: 'owner',
      blockNumber,
    }),
    client.readContract({
      address: router,
      abi: proofRouterAbi,
      functionName: 'pendingOwner',
      blockNumber,
    }),
    client.readContract({
      address: router,
      abi: proofRouterAbi,
      functionName: 'policyHash',
      blockNumber,
    }),
  ]);
  const cfg = addresses[chain === 133 ? 133 : 177];
  const [decimalsA, decimalsB] = await Promise.all(
    [cfg.whsk.address, cfg.usdt.address].map((token) =>
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'decimals',
        blockNumber,
      }),
    ),
  );
  const [
    agent,
    expiry,
    maxTradeInA,
    maxTradeInB,
    maxDailyInB,
    maxExposureBps,
    maxSlippageBps,
    maxDrawdownBps,
    minIntervalSec,
    policyHash,
  ] = raw as readonly [
    Address,
    bigint,
    bigint,
    bigint,
    bigint,
    number,
    number,
    number,
    bigint,
    `0x${string}`,
  ];
  return {
    owner: owner as Address,
    pendingOwner: pendingOwner as Address,
    routerOwner: routerOwner as Address,
    routerPendingOwner: routerPendingOwner as Address,
    routerPolicyHash,
    policiesMatch: policyHash.toLowerCase() === routerPolicyHash.toLowerCase(),
    paused: paused as boolean,
    mandate: {
      agent,
      expiry,
      maxTradeInA,
      maxTradeInB,
      maxDailyInB,
      maxExposureBps,
      maxSlippageBps,
      maxDrawdownBps,
      minIntervalSec,
      policyHash,
    },
    decimalsA,
    decimalsB,
    blockNumber,
  };
}
export const displayTime = (seconds: number | bigint) =>
  `${new Date(Number(seconds) * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
