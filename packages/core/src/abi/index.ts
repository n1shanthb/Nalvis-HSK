import { parseAbi } from 'viem';
// Manual typed exports of the public interfaces in contracts/src (solc 0.8.24).
// Full artifact exports can be refreshed with forge build && node scripts/export-abis.mjs.
export const receiptEvent =
  'event Receipt(uint64 indexed seq, bytes32 indexed receiptHash, bytes32 prevHead, bytes32 policyHash, uint8 kind, address tokenIn, uint256 amountIn, uint256 amountOut, uint256 minOut, uint256 refOut)' as const;
export const vaultAbi = parseAbi([
  receiptEvent,
  'function owner() view returns (address)',
  'function tokenA() view returns (address)',
  'function tokenB() view returns (address)',
  'function router() view returns (address)',
  'function pool() view returns (address)',
  'function fee() view returns (uint24)',
  'function twapWindowSec() view returns (uint32)',
  'function seq() view returns (uint64)',
  'function head() view returns (bytes32)',
  'function nextNonce() view returns (uint256)',
  'function lastTradeAt() view returns (uint256)',
  'function dailyBucket() view returns (uint256)',
  'function dailyNotionalB() view returns (uint256)',
  'function paused() view returns (bool)',
  'function mandate() view returns (address agent,uint256 expiry,uint256 maxTradeInA,uint256 maxTradeInB,uint256 maxDailyInB,uint16 maxExposureBps,uint16 maxSlippageBps,uint256 minIntervalSec,bytes32 policyHash)',
  'function trade((address tokenIn,uint256 amountIn,uint256 minOut,uint256 deadline,uint256 nonce,bytes32 receiptHash,bytes32 prevHead,uint8 kind) p) returns (uint256)',
  'function commitHold(bytes32 receiptHash,bytes32 prevHead,uint8 kind)',
  'function revoke()',
  'function pause()',
  'function unpause()',
  'function setMandate((address agent,uint256 expiry,uint256 maxTradeInA,uint256 maxTradeInB,uint256 maxDailyInB,uint16 maxExposureBps,uint16 maxSlippageBps,uint256 minIntervalSec,bytes32 policyHash) m)',
]);
export const proofRouterAbi = parseAbi([
  receiptEvent,
  'function owner() view returns (address)',
  'function router() view returns (address)',
  'function policyHash() view returns (bytes32)',
  'function seq(address caller) view returns (uint64)',
  'function head(address caller) view returns (bytes32)',
  'function commitHold(bytes32 receiptHash,bytes32 prevHead,uint8 kind)',
  'function commitAndSwap(bytes32 receiptHash,bytes32 prevHead,(address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) p,uint256 deadline) returns (uint256)',
]);
export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
export const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);

export const poolReadAbi = parseAbi([
  'function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)',
]);
