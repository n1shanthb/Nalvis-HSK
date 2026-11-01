// Generates unsigned policy/calldata only. No wallet or broadcast capability.
import { createPublicClient, http, parseAbi, parseUnits, encodeFunctionData } from 'viem';
import { writeFile } from 'node:fs/promises';
import { addresses } from './dist/core/src/addresses.js';
import { configFromEnv, createAgentPolicy, agentPolicyHash } from './dist/core/src/agent/policy.js';
import { vaultAbi } from './dist/core/src/abi/index.js';
const env = process.env;
async function main() {
  if (!env.HSK_MAINNET_RPC || !env.STRATEGIST_MODEL || !env.FITTER_MODEL || !/^0x[\da-fA-F]{40}$/.test(env.AGENT_ADDRESS ?? '')) throw Error('Missing public configuration');
  const c = createPublicClient({ transport: http(env.HSK_MAINNET_RPC, { retryCount: 0 }) });
  if (await c.getChainId() !== 177) throw Error('Expected chain 177');
  const a = addresses[177], block = await c.getBlock();
  const abi = parseAbi(['function decimals() view returns(uint8)', 'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
  const [da, db] = await Promise.all([a.whsk.address, a.usdt.address].map(address => c.readContract({address, abi, functionName:'decimals',blockNumber:block.number})));
  if (da !== 18 || db !== 6) throw Error('Decimals mismatch');
  const maxB = parseUnits('0.10', db);
  const q = await c.simulateContract({ address:a.quoterV2.address, abi, functionName:'quoteExactInputSingle', args:[{ tokenIn:a.usdt.address,tokenOut:a.whsk.address,amountIn:maxB,fee:3000,sqrtPriceLimitX96:0n }], blockNumber:block.number });
  if (q.result[0] <= 0n) throw Error('Zero quote');
  const mandate = { expiry:Number(block.timestamp)+86400, maxTradeInA:q.result[0], maxTradeInB:maxB, maxDailyInB:parseUnits('0.50',db),maxExposureBps:8000,maxSlippageBps:100,maxDrawdownBps:1000,minIntervalSec:300 };
  const config = configFromEnv('', {...env, EXECUTION_CHAIN:'177', AGENT_POLL_SEC:env.AGENT_POLL_SEC ?? '30'});
  const policy = createAgentPolicy(config,{ executionChainId:177, mandate, pilotFundingCeilingUsdt:'3.00' });
  const policyHash = agentPolicyHash(policy);
  const data = encodeFunctionData({ abi:vaultAbi,functionName:'setMandate',args:[{...mandate,expiry:BigInt(mandate.expiry),agent:env.AGENT_ADDRESS,policyHash}] });
  await writeFile('policy/agent-mainnet-v3.json',policy,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({executionChainId:177,block:String(block.number),policyHash,mandate,calldata:data,warning:'Unsigned review only. 0.10 USDT per trade, 0.50 rolling daily, 24h expiry. No guarantee of execution. Revoke/pause before increasing exposure.'},(_,v)=>typeof v==='bigint'?String(v):v,2));
}
main().catch(()=>{console.error('Policy generation refused. Check public configuration, RPC, quotes and existing output file. Never overwrite a signed policy silently.');process.exitCode=1;});
