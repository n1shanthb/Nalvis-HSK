// Read-only readiness probe. No wallet, signing, approval or broadcast capability.
import { createPublicClient, http, parseAbi, parseUnits, formatUnits } from 'viem';
import { addresses } from './dist/core/src/addresses.js';

const cfg = addresses[177];
const abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function observe(uint32[]) view returns (int56[],uint160[])',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);
async function main() {
  const rpc = process.env.HSK_MAINNET_RPC;
  if (!rpc) throw Error('Set HSK_MAINNET_RPC');
  const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 15000 }) });
  if (await client.getChainId() !== 177) throw Error('Expected chain 177');
  const block = await client.getBlock();
  const read = (address, functionName, args = []) => client.readContract({ address, abi, functionName, args, blockNumber: block.number });
  for (const address of [cfg.whsk.address, cfg.usdt.address, cfg.primaryPool.address, cfg.quoterV2.address, cfg.swapRouter02.address]) {
    const code = await client.getCode({ address, blockNumber: block.number });
    if (!code || code === '0x') throw Error('Configured contract has no bytecode');
  }
  const [da, db, token0, token1, fee, liquidity] = await Promise.all([
    read(cfg.whsk.address, 'decimals'), read(cfg.usdt.address, 'decimals'),
    read(cfg.primaryPool.address, 'token0'), read(cfg.primaryPool.address, 'token1'),
    read(cfg.primaryPool.address, 'fee'), read(cfg.primaryPool.address, 'liquidity'),
  ]);
  const pair = [token0, token1].map(x => x.toLowerCase());
  if (!pair.includes(cfg.whsk.address.toLowerCase()) || !pair.includes(cfg.usdt.address.toLowerCase()) || da !== 18 || db !== 6 || fee !== 3000 || liquidity === 0n) throw Error('Pool configuration differs from registry');
  // Match the existing deployment's 600-second TWAP requirement. Fail closed.
  await read(cfg.primaryPool.address, 'observe', [[600, 0]]);
  const quote = async (tokenIn, tokenOut, amountIn) => {
    const result = await read(cfg.quoterV2.address, 'quoteExactInputSingle', [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }]);
    if (result[0] <= 0n) throw Error('Zero output quote');
    return result[0];
  };
  const rows = [];
  for (const size of ['0.10', '0.50', '1.00']) {
    const input = parseUnits(size, db);
    const whsk = await quote(cfg.usdt.address, cfg.whsk.address, input);
    const returned = await quote(cfg.whsk.address, cfg.usdt.address, whsk);
    rows.push({ inputUsdt: size, quotedWhsk: formatUnits(whsk, da), reverseQuoteUsdt: formatUnits(returned, db) });
  }
  console.log(JSON.stringify({ chainId: 177, block: String(block.number), timestamp: String(block.timestamp), pool: cfg.primaryPool.address, twap600Available: true, quotes: rows, executionEnabled: false, limitations: 'Independent same-block quotes, not a simulated round trip. Does not verify vault deployment, Ledger, receipt compatibility, gas budget or execution.' }, null, 2));
}
main().catch(() => { console.error('Readiness probe failed. Check RPC, chain identity, registry, pool history and quotes. No transaction sent.'); process.exitCode = 1; });
