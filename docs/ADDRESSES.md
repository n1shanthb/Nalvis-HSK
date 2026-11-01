# Addresses (verified only)

**Rule:** code may use only addresses listed here. A new address needs a source and a live `eth_getCode` check before it goes in this file. Anything unverified must be labelled **UNVERIFIED** and must never be hard-coded.

**Verification:** every contract below returned non-empty bytecode from `eth_getCode` on 28 Oct 2026 at about 13:06 IST. Mainnet was queried via https://mainnet.hsk.xyz and testnet via https://testnet.hsk.xyz.

**Sources:**
- **[sdk]**: npm `@hskswap/sdk-core@1.0.3`. Mainnet comes from the HashKey mainnet address map and testnet from `HASHKEY_TESTNET_ADDRESSES`.
- **[recon]**: on-chain reads (`token0()`, `token1()`, `decimals()`, `factory.getPool`) plus the HSKSwap subgraph, from the Oct 26–27 research.
- **[docs]**: HashKey Chain developer docs (Oracle page).
- **[logs]**: testnet pool and token discovery from Swap/Mint logs via the testnet Blockscout API (testnet-explorer.hskchain.net).

## Networks

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 177 | 133 |
| RPC | https://mainnet.hsk.xyz | https://testnet.hsk.xyz |
| Explorer (live) | https://hsk.blockscout.com (HTTP 200) | https://testnet-explorer.hskchain.net (HTTP 200) |
| Gas (observed 28 Oct) | ~500 gwei | ~1–2 gwei |
| Native token | HSK | HSK (test) |

Explorer notes:
- The docs list `hashkey.blockscout.com`, which returns 301, and `testnet-explorer.hsk.xyz`, which failed to connect. Use the explorers in the table above.
- Faucet: the docs list https://faucet.hsk.xyz, which 301-redirects to https://faucet.hashkeychain.net/. **UNVERIFIED**: we have not claimed from it.

`eth_getLogs` on mainnet RPC: a 5,000-block range worked and a 9,999-block range returned HTTP 400. Chunk log queries at ≤ 5,000 blocks (about 2.8 h at 2 s blocks).

## Mainnet — chain 177 (READ-ONLY for this project; never broadcast)

### HSKSwap V3 (Uniswap V3 fork) [sdk]

| Contract | Address |
|---|---|
| V3 Factory | `0x972cA9D1662F5e029cD18327D29026532E84c742` |
| QuoterV2 | `0x603f70466fDdbE3F238220B9a74FFF419a2BbFDD` |
| SwapRouter02 | `0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3` |
| UniversalRouter | `0x76d86a6e224b19270c2cda31477a4c79b2d56918` |
| NonfungiblePositionManager | `0xDF0A9b833Db0E4CeEa103A4408f3B68e7FC0cad5` |
| V4 PoolManager (dormant; not used) | `0xa5ef140471486a25a71cd75AE38A26e945D2E3c4` |
| Permit2 (canonical) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Multicall3 (canonical) | `0xcA11bde05977b3631167028862bE2a173976CA11` |

SwapRouter02's `exactInputSingle` params struct has **no deadline**: `{tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96}`. Enforce the deadline in our contract, or wrap the call in `multicall(uint256 deadline, bytes[])`.

### Tokens [recon]

| Token | Address | Decimals |
|---|---|---|
| WHSK | `0xB210D2120d57b758EE163cFfb43e73728c471Cf1` | 18 (has `deposit()`/`withdraw(uint256)` selectors) |
| USDT | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` | **6** |
| WETH | `0xefd4bC9afD210517803f293ABABd701CaeeCdfd0` | not used |
| WBTC | `0x6119ca49a79f5825c8b345f8d7ac36b272565b14` | not used |
| USDC.e | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` | not used |

### Pools [recon]

| Pool | Address | Notes |
|---|---|---|
| WHSK/USDT 0.3% | `0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC` | token0 = WHSK, token1 = USDT. observationCardinality = 16. **Primary pool.** |
| USDT/WETH 0.3% | `0xb92b79ed6b370D5cFee2E14B1D0983C258304C16` | not used |
| USDT/WBTC 0.3% | `0xd9EA2cE468957Ba49cCC38C4758Ed6ecD561449A` | not used |

### Oracle — APRO HSK/USD [docs + live read]

| Feed | Address | Decimals | Interface |
|---|---|---|---|
| APRO HSK/USD | `0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b` | 8 | Chainlink-style `latestRoundData()` |

APRO caveats:
- **Docs typo:** the HashKey Oracle docs page prints `0x86CE42c1b714149Dc3A7b169EF67b5F78A224b`, which is 38 hex characters and invalid. The 40-hex address above is the one with code.
- **Staleness:** on 28 Oct at about 13:06 IST, `answer` was 0.08921597 and `updatedAt` was 1793098295 (27 Oct, 16:21:35 IST), so the feed was **20.8 h old**. The docs claim a 0.5% deviation threshold and a 1 h heartbeat, but the observed behaviour does not match the 1 h heartbeat. Use APRO only as a wide sanity band, record its age in every evidence pack, and never use it as the execution price.
- **Pyth:** not deployed on 177 or 133.

### Off-chain data (public, read-only; verified reachable 28 Oct 2026)

| Source | Endpoint | Status |
|---|---|---|
| HSKSwap subgraph | `https://graphnode.hashkeychain.net/subgraphs/name/hskdex-subgraph` (GraphQL; entity `v3Swaps`) | Returned the latest swap on the primary pool |
| MEXC ticker | `https://api.mexc.com/api/v3/ticker/bookTicker?symbol=HSKUSDT` | 200; bid 0.08914 / ask 0.08922 |
| MEXC klines | `https://api.mexc.com/api/v3/klines?symbol=HSKUSDT&interval=60m` | Used in research |
| Gate ticker | `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=HSK_USDT` | 200; last 0.08918 |
| Gate candles | `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=HSK_USDT&interval=1h` | Used in research |

Rate limits and terms of use for these APIs are **UNVERIFIED**. Poll politely (≥ 30 s) and cache.

## Testnet — chain 133 (the ONLY chain we broadcast on)

### HSKSwap V3 [sdk: HASHKEY_TESTNET_ADDRESSES]

| Contract | Address |
|---|---|
| V3 Factory | `0x2dC2c21D1049F786C535bF9d45F999dB5474f3A0` |
| QuoterV2 | `0x73820d9eE5Bf1BfcD429580320FC7A374E8fa1cC` |
| SwapRouter02 | `0xa6914E66690c6794244B5f66a09eAEbf66254237` |
| NonfungiblePositionManager | `0x73dEc6bfa6751509b08480bd97f54b874E3b20e8` |
| Multicall | `0x47F625Ec29637445AA1570d7008Cf78692CdA096` |

### Tokens

| Token | Address | Decimals | Source |
|---|---|---|---|
| WHSK | `0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6` | 18 | [sdk]; has `deposit()`/`withdraw(uint256)` selectors |
| USDT (test) | `0x98b6173a8b7dfc52ce8bc88f1184a918a1ccaa4f` | **18** (not 6 like mainnet) | [logs] |

### Pools [logs + on-chain reads]

| Pool | Address | Notes |
|---|---|---|
| USDT/WHSK 0.3% | `0xc076fb478b77633736738579c7f48d2539604a50` | ~23,824 USDT / ~469.9 WHSK on 27 Oct. observationCardinality 16. **Primary testnet pool.** |
| USDT/WHSK 0.05% | `0xff2b7e501c870980bf5641b4a70d0f9fb0f6f6ab` | thinner |

Testnet caveats:
- **Testnet prices are fake.** On 27 Oct the pools quoted about 54.4 USDT/WHSK (0.3%) and about 78.4 USDT/WHSK (0.05%), while the real price was about $0.089. The testnet is for execution mechanics only. Never present testnet P&L as real.
- **APRO on 133:** the mainnet APRO address has **no code on 133**, and there is no known oracle on testnet.
- **Getting test USDT** (**UNVERIFIED** procedure): claim test HSK from the faucet, call `WHSK.deposit{value: x}()`, then swap WHSK→USDT on the 0.3% pool through the testnet SwapRouter02.

## Our deployments

### HSK Testnet — chain 133

Verified by read-only RPC calls on 1 Nov 2026. Both receipts succeeded in block
`35175424`; deployed bytecode was present and both contracts report the
temporary owner as `owner()`. The Blockscout address API confirms both
addresses are contracts and lists the matching creation transaction hashes.

| Contract | Address | Deployment transaction | Source commit |
|---|---|---|---|
| EdgewiseVault | `0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc` | `0xcb7480c81476eb9eb76f4ef7eab8e872e3d5c94cde4b23173b1ca9ad247c6941` | `00f79c4ea5fcced27b3e33940a62ba56928f1b7e` |
| ProofTradeRouter | `0xC5Fa869C8423B41696886A7761ec31b3846f4e4B` | `0x24519a67fa5a3f4e050ce73249b0099503fcad08424b106ad8a9fed70cae031f` | `00f79c4ea5fcced27b3e33940a62ba56928f1b7e` |

Both constructors used owner
`0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927` and SwapRouter02
`0xa6914E66690c6794244B5f66a09eAEbf66254237`. The vault additionally used
pool `0xc076FB478b77633736738579c7f48D2539604a50`, WHSK
`0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6`, test-USDT
`0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F`, fee 3000, TWAP window 600,
and zero oracle configuration. The configured agent is not yet set in the
vault mandate; the router policy hash is zero. Full receipt and state details
are recorded in [`contracts/deployments/133.json`](../contracts/deployments/133.json).

## Ephemeral local verifier fixture (chain 31337 only)

The T6 recording uses a local fork of mainnet block 29413000. This is not a
network deployment or an address to use for broadcasting. Source: the T5 Anvil
integration deploys EdgewiseVault from the compiled artifact and records real
keeper transactions; verifier capture read nonempty bytecode and token/fee
configuration at the mined block.

| Contract      | Local fork address                           | Recorded first trade transaction                                     |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| EdgewiseVault | `0x663f3ad617193148711d28f5334ee4ed07016602` | `0x8f76b8333e1797a156c9605d17ee959cf7d95e3da3c945616c07f0985d82b784` |

Recording keeper revision: `08cea51` (replay snapshot extension), based on T5
`e1033a1`. Constructor inputs: the public Anvil account 0 owner, configured
SwapRouter02/pool/WHSK/USDT on 177, fee 3000, TWAP window 600, oracle zero,
oracle band/max-age zero. Deployment transaction hash was not captured and is
UNVERIFIED; the trade hash above is not a deployment hash. The manifest is only
test provenance. See `packages/verifier/test/fixtures/README.md`.
