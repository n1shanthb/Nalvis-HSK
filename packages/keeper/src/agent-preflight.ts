import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { addresses } from '../../core/src/addresses.js';
import {
  configFromEnv,
  validateAgentPolicy,
} from '../../core/src/agent/policy.js';
import { repositoryRoot } from './config.js';
export async function agentPreflight(env = process.env) {
  const names = [
    'OPENROUTER_API_KEY',
    'STRATEGIST_MODEL',
    'FITTER_MODEL',
    'AGENT_PRIVATE_KEY',
    'HSK_TESTNET_RPC',
    'VAULT_ADDRESS',
    'AGENT_ADDRESS',
    'DEPLOYER_ADDRESS',
    'AGENT_FEED_URL',
  ] as const;
  for (const name of names) {
    if (!env[name]?.trim()) throw Error(`Missing env name: ${name}`);
    console.log(`${name}: present`);
  }
  const url = new URL(env.AGENT_FEED_URL!);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw Error('Feed must use HTTPS without URL credentials');
  const health = await fetch(new URL('/healthz', url), {
    signal: AbortSignal.timeout(8000),
  });
  if (!health.ok) throw Error('HTTPS feed health failed');
  const client = createPublicClient({
    transport: http(env.HSK_TESTNET_RPC!, { retryCount: 0, timeout: 15000 }),
  });
  if ((await client.getChainId()) !== 133)
    throw Error('Preflight requires chain 133');
  if (!/^0x[\da-fA-F]{64}$/.test(env.AGENT_PRIVATE_KEY!))
    throw Error('AGENT_PRIVATE_KEY invalid');
  const signer = privateKeyToAccount(env.AGENT_PRIVATE_KEY as `0x${string}`);
  if (signer.address.toLowerCase() !== env.AGENT_ADDRESS!.toLowerCase())
    throw Error('AGENT_ADDRESS differs from signer');
  const vault = env.VAULT_ADDRESS as Address,
    a = addresses[133];
  const abi = parseAbi([
    'function mandate() view returns(address,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint256,bytes32)',
    'function balanceOf(address) view returns(uint256)',
    'function decimals() view returns(uint8)',
    'function owner() view returns(address)',
    'function paused() view returns(bool)',
  ]);
  const [mandate, da, db, va, vb, deployer, agent, owner, paused] =
    await Promise.all([
      client.readContract({ address: vault, abi, functionName: 'mandate' }),
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
      client.readContract({
        address: a.whsk.address,
        abi,
        functionName: 'balanceOf',
        args: [vault],
      }),
      client.readContract({
        address: a.usdt.address,
        abi,
        functionName: 'balanceOf',
        args: [vault],
      }),
      client.getBalance({ address: env.DEPLOYER_ADDRESS as Address }),
      client.getBalance({ address: signer.address }),
      client.readContract({ address: vault, abi, functionName: 'owner' }),
      client.readContract({ address: vault, abi, functionName: 'paused' }),
    ]);
  const policy = await readFile(
    env.AGENT_POLICY_FILE ?? join(repositoryRoot(), 'policy/agent-v3.json'),
    'utf8',
  );
  if (validateAgentPolicy(configFromEnv(policy, env)) !== mandate[9])
    throw Error('policyHash mismatch; owner signature required');
  if (mandate[0].toLowerCase() !== signer.address.toLowerCase())
    throw Error('Mandate agent differs from signer');
  if (
    new Set(
      [owner, signer.address, env.DEPLOYER_ADDRESS!].map((s) =>
        s.toLowerCase(),
      ),
    ).size !== 3
  )
    throw Error('Roles must be distinct');
  if (paused || mandate[1] <= (await client.getBlock()).timestamp)
    throw Error('Mandate paused or expired');
  if (deployer < 3n * 10n ** 18n || agent < 5n * 10n ** 17n)
    throw Error(
      'Faucet UNVERIFIED: deployer needs >=3 test HSK and agent >=0.5',
    );
  if (va < 10n ** BigInt(da) / 2n || vb < 50n * 10n ** BigInt(db))
    throw Error('Vault needs >=0.5 WHSK and >=50 test USDT');
  console.log(
    'PASS: HTTPS feed, chain 133, policy hash, mandate agent, distinct roles and funding thresholds',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  agentPreflight().catch(() => {
    console.error(
      'FAIL: preflight incomplete. Check required env names, HTTPS feed, policy/mandate and funding. No env values are logged.',
    );
    process.exitCode = 1;
  });
