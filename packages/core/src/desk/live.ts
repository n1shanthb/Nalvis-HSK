import { getAddress, type Address, type PublicClient } from 'viem';
import { z } from 'zod';
import { vaultAbi, erc20Abi } from '../abi/index.js';
import { addresses, assertWritableChain } from '../addresses.js';
import { mandateSchema, policyHash, type Policy } from '../policy.js';
/** One pinned live read shared by CLI and browser. No account, signature or send API. */
export async function readDeskMandate(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'readContract'>,
  vault: Address,
  expectedChain: number,
  policy: Policy,
) {
  assertWritableChain(expectedChain);
  if ((await client.getChainId()) !== expectedChain)
    throw Error('Live vault RPC chain mismatch');
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const config = addresses[expectedChain === 133 ? 133 : 177];
  const [raw, p, d] = await Promise.all([
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'mandate',
      blockNumber,
    }),
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'paused',
      blockNumber,
    }),
    client.readContract({
      address: config.usdt.address,
      abi: erc20Abi,
      functionName: 'decimals',
      blockNumber,
    }),
  ]);
  const m = z
    .tuple([
      z.string().transform((v) => getAddress(v)),
      z.bigint(),
      z.bigint(),
      z.bigint(),
      z.bigint(),
      z.number(),
      z.number(),
      z.number(),
      z.bigint(),
      z.string(),
    ])
    .parse(raw);
  const mandate = mandateSchema.parse({
    revoked: /^0x0{40}$/i.test(m[0]),
    expiry: Number(m[1]),
    maxTradeInA: m[2],
    maxTradeInB: m[3],
    maxDailyInB: m[4],
    maxExposureBps: m[5],
    maxSlippageBps: m[6],
    maxDrawdownBps: m[7],
    minIntervalSec: Number(m[8]),
    policyHash: m[9],
  });
  if (policyHash(policy) !== mandate.policyHash)
    throw Error(
      'Policy hash differs from current vault mandate; load the matching policy',
    );
  return {
    mandate,
    agent: m[0],
    paused: z.boolean().parse(p),
    decimalsB: z.number().int().min(0).max(36).parse(d),
    target: { vault, chainId: expectedChain },
    blockNumber,
  };
}
