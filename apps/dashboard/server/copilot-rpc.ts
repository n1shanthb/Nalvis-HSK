import {
  createPublicClient,
  http,
  formatUnits,
  formatEther,
  zeroHash,
} from 'viem';
import { hskMainnet } from '../../../packages/core/src/chains.js';
import { addresses } from '../../../packages/core/src/addresses.js';
import { vaultAbi, quoterAbi } from '../../../packages/core/src/abi/index.js';
import {
  readMandateState,
  amountFor,
  calldata,
  simulate,
} from '../../../packages/core/src/agent/mandate-check.js';
import {
  sellActionFor,
  sellPreview,
} from '../../../packages/core/src/agent/owner-preview.js';
import {
  sellSessionSchema,
  type SellSession,
} from '../../../packages/core/src/copilot.js';
import manifest from '../../../contracts/deployments/177.json';
import type { Address } from 'viem';

const client = createPublicClient({
  chain: hskMainnet,
  transport: http(undefined, { timeout: 12000, retryCount: 0 }),
  cacheTime: 0,
});
const vault = manifest.vault as Address;
export async function copilotState() {
  const state = await readMandateState(
    client,
    vault,
    undefined,
    manifest.agent as Address,
  );
  if (
    state.chainId !== 177 ||
    state.tokenA.toLowerCase() !== addresses[177].whsk.address.toLowerCase() ||
    state.tokenB.toLowerCase() !== addresses[177].usdt.address.toLowerCase()
  )
    throw Error('Deployment network or token mismatch');
  const owner = await client.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'owner',
    blockNumber: state.block,
  });
  return { state, owner };
}
export async function copilotPreview(sessionInput: unknown) {
  const session = sellSessionSchema.parse(sessionInput);
  const { state, owner } = await copilotState();
  if (
    session.owner.toLowerCase() !== owner.toLowerCase() ||
    session.vault.toLowerCase() !== vault.toLowerCase() ||
    session.chainId !== state.chainId ||
    session.policyHash !== state.mandate.policyHash ||
    session.expiresAt <= state.blockTime ||
    session.expiresAt - session.issuedAt > 900
  )
    throw Error('Owner session does not match the live mandate');
  const status = {
    owner,
    vault,
    chainId: state.chainId,
    block: String(state.block),
    asOf: state.blockTime,
    balanceA: formatUnits(state.balanceA, state.decimalsA),
    balanceB: formatUnits(state.balanceB, state.decimalsB),
    pnl: null,
    pnlReason:
      'Verified cost basis is unavailable; profit or loss is not assumed to be zero.',
    scope: 'Owner-directed WHSK → USDT. Proceeds remain in the vault.',
  };
  if (state.balanceA === 0n)
    return {
      ...status,
      executable: false,
      reason: 'There is no WHSK position to sell. No swap can be submitted.',
    };
  const action = sellActionFor(state),
    amountIn = amountFor(action, state);
  const fee = await client.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'fee',
    blockNumber: state.block,
  });
  const q = await client.simulateContract({
    address: addresses[177].quoterV2.address,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    blockNumber: state.block,
    args: [
      {
        tokenIn: state.tokenA,
        tokenOut: state.tokenB,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const quote = {
    block: state.block,
    at: state.blockTime,
    amountIn,
    amountOut: q.result[0],
  };
  const preview = sellPreview(state, quote, session as SellSession);
  const simulation = preview.checked.ok
    ? await simulate(client, state, preview.checked.prepared)
    : { ok: false };
  let gasHSK: string | null = null;
  if (simulation.ok) {
    const [gas, price] = await Promise.all([
      client.estimateGas({
        account: state.agent,
        to: vault,
        data: calldata(preview.checked.prepared, zeroHash),
      }),
      client.getGasPrice(),
    ]);
    gasHSK = formatEther(gas * price);
  }
  return {
    ...status,
    executable: preview.checked.ok && simulation.ok,
    reason:
      preview.checked.violations.map((v) => v.limit).join(', ') ||
      (!simulation.ok ? 'On-chain simulation failed' : ''),
    order: preview.order,
    sellWHSK: formatUnits(amountIn, state.decimalsA),
    expectedUSDT: formatUnits(quote.amountOut, state.decimalsB),
    minimumUSDT: formatUnits(preview.checked.prepared.minOut, state.decimalsB),
    remainingWHSK: formatUnits(state.balanceA - amountIn, state.decimalsA),
    partialExit: amountIn < state.balanceA,
    slippageBps: state.mandate.maxSlippageBps,
    feePpm: fee,
    poolFeeWHSK: formatUnits(
      (amountIn * BigInt(fee)) / 1_000_000n,
      state.decimalsA,
    ),
    estimatedGasHSK: gasHSK,
  };
}
