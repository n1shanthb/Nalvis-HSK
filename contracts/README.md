# T2 contracts

Solidity 0.8.24, optimizer 200 runs. No initializer, upgradeability or structural
setters. ProofTradeRouter's constructor is `(owner, router)`; EdgewiseVault uses
the ten constructor parameters in AGENTS.md. ReceiptChain stores the shared
`Chain` type: vault `seq()/head()`, router `seq(caller)/head(caller)`.

The local MIT-licensed `ReentrancyGuard` is a minimal 1/2 storage mutex, used on
fund-moving functions and hold commits. SafeToken accepts empty ERC20 returns
and checks exact receipt of transferFrom deposits. Fee-on-transfer/rebasing tokens
are unsupported. Router approvals are exact and reset to zero after every swap.

Daily spend uses UTC fixed 24-hour buckets, not a sliding lookback; trades on
opposite sides of midnight may consume two daily caps in a short interval.
Mandate changes preserve spend, nonce and trade interval history. Exposure is
`value(tokenA) / (value(tokenA) + balance(tokenB))`, using post-swap balances and
the same pre-swap TWAP for both. T3 permits a swap above the mandate cap only
when its post-swap exposure is strictly lower than its pre-swap exposure.
ProofTradeRouter rejects nonzero sqrtPriceLimitX96 before pulling funds, so
SwapRouter02 cannot partially consume input at a caller-selected price limit. Holds require a live, unpaused mandate and do
not advance the trade nonce, interval or notional.

TWAP floors negative fractional mean ticks toward negative infinity. Pool token
order comes from address ordering and the constructor validates the configured
pair and fee. Decimal scales are read once in the constructor. The optional
oracle compares one whole tokenA's tokenB value to tokenA/USD; tokenB's USD peg
is an UNVERIFIED assumption. It rejects nonpositive answers, zero/future/stale
timestamps, incomplete rounds, invalid decimal scales and out-of-band prices.

APRO contract reads **revert** at block 29413000 in a normal deployed-contract
call. Fork vaults disable the oracle (`address(0)`); APRO belongs in off-chain
evidence. If contract reads become available at another pinned block, the fork
harness uses `oracleMaxAge = 604800` (7 days) and separately tests max age zero.
The MockAggregator max-age failure test always runs offline.

Math sources are pinned to Uniswap/v3-core v1.0.0:

- `src/lib/TickMath.sol`: GPL-2.0-or-later, retained tick-to-sqrt function with
  Solidity 0.8-compatible signed-to-unsigned cast.
- `src/lib/FullMath.sol`: MIT (Remco Bloemen attribution retained), retained
  `mulDiv` with unchecked modular arithmetic for the 0.8 port.

Original headers and source URLs/version are in the files. The combined vault
contains GPL TickMath; distribution of the combined artifact is subject to
GPL-2.0-or-later. Local project code otherwise carries MIT headers.

Verification:

```sh
cd contracts
forge test -vvv
forge coverage --report summary --no-match-coverage '(src/lib/(TickMath|FullMath)\.sol|test/|script/)'
forge build --sizes
forge test --match-contract VaultForkTest --match-test testReal50USDTTrade --gas-report -vv
cd ..
bash scripts/check-rules.sh
pnpm test
```

Forks use HSK_MAINNET_RPC and FORK_BLOCK_177; absent/unreachable RPC is explicitly
reported SKIP. There is no deploy script and no broadcast in T2. Unit fuzz tests
check allowance reset and sequence/head agreement after repeated bounded swaps.
