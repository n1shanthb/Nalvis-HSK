# T13A chart validation

Base: `8c4632f` (`main`, T12B merged; T13 was not merged when this branch started).

## Checks

- `pnpm lint`: PASS (workspace ESLint and root TypeScript project check).
- `pnpm -r build`: PASS.
- `pnpm test`: PASS: 414 tests; four pre-existing integration skips (no anvil/fork setup).
- New dashboard chart tests: 14 passing; keeper feed projection: one passing.
- Existing test files and expectations are unchanged. No snapshot/class updates.
- `forge test`: not run; forge/anvil binaries are unavailable. Contracts were not changed.
- Charts use public reads and recorded fixtures. No application API keys, signing, transactions, or mainnet writes.

## JavaScript size (Vite gzip, decimal kB)

| Measurement | Before | After | Increase | Limit |
| --- | ---: | ---: | ---: | ---: |
| Initial landing entry and its modulepreloads | 415.79 | 423.29 | 7.50 | 15.00 |
| All JavaScript chunks | 434.98 | 492.95 | 57.97 | 60.00 |

The canvas library remains a React.lazy chunk. Shared chart views reduce duplicate chunk overhead. The frozen mainnet history is one validated, cached same-origin JSON asset, not JavaScript; its additional gzip size is 16.26 kB and is excluded from the JavaScript figures above. No new market-data host is used.

### Before: Vite build sizes

```text
dist/receipts/index.json                                                                              0.48 kB │ gzip:   0.27 kB
dist/index.html                                                                                       1.03 kB │ gzip:   0.54 kB
dist/receipts/demo/31337/3-0x4ad6ac5f8db3a298f044a2a8f4d67227a6da2bc77a31da3d53db1919aaa35df8.json    3.12 kB │ gzip:   1.10 kB
dist/receipts/demo/31337/0-0xf925bc8b8690e441f159044d5044d3e8d07bf2bf7098bbfff2934408361459ce.json    3.47 kB │ gzip:   1.16 kB
dist/receipts/demo/31337/1-0xb82d82cc03fa2e4b06d73281fd8155464ef2a250fbf9a3caa0ee1ce4c3898f19.json    3.69 kB │ gzip:   1.21 kB
dist/receipts/demo/31337/2-0xccbf1e23e1a1568ee2feec8086705fe7252d50f38c411deb5a9a00c982c2d884.json    3.83 kB │ gzip:   1.22 kB
dist/receipts/31337/0-0xc139451c312735428d725ce3c513c6b0aafaff870e152406968a8cd316d9fca9.json         5.41 kB │ gzip:   1.67 kB
dist/assets/index-B2fzy543.css                                                                       38.70 kB │ gzip:   9.35 kB
dist/assets/LandingPreview-BmxGj2Kw.js                                                                2.30 kB │ gzip:   0.94 kB
dist/assets/ccip-D0dfn-ii.js                                                                          3.19 kB │ gzip:   1.47 kB
dist/assets/Receipts-MMCJiHst.js                                                                      3.67 kB │ gzip:   1.46 kB
dist/assets/Mandate-DPIR0Lzm.js                                                                       4.04 kB │ gzip:   1.79 kB
dist/assets/Console-BgdNLgW6.js                                                                       8.61 kB │ gzip:   2.84 kB
dist/assets/Desk-Ds_PRYGE.js                                                                         10.73 kB │ gzip:   4.68 kB
dist/assets/ledger-streams-U9X4ypUY.js                                                               27.77 kB │ gzip:   8.48 kB
dist/assets/ledger-transport-QmNX_acP.js                                                             28.78 kB │ gzip:   8.71 kB
dist/assets/Verify-CEQhKaI2.js                                                                       30.14 kB │ gzip:   6.01 kB
dist/assets/ledger-device-BE-YRHtZ.js                                                               257.32 kB │ gzip:  69.27 kB
dist/assets/ledger-ethereum-CKAlsWBU.js                                                             394.87 kB │ gzip: 102.26 kB
dist/assets/index-C5_pVQNR.js                                                                       752.66 kB │ gzip: 227.07 kB
```

### After: Vite build sizes

```text
dist/receipts/index.json                                                                              0.48 kB │ gzip:   0.27 kB
dist/index.html                                                                                       1.11 kB │ gzip:   0.56 kB
dist/receipts/demo/31337/3-0x4ad6ac5f8db3a298f044a2a8f4d67227a6da2bc77a31da3d53db1919aaa35df8.json    3.12 kB │ gzip:   1.10 kB
dist/receipts/demo/31337/0-0xf925bc8b8690e441f159044d5044d3e8d07bf2bf7098bbfff2934408361459ce.json    3.47 kB │ gzip:   1.16 kB
dist/receipts/demo/31337/1-0xb82d82cc03fa2e4b06d73281fd8155464ef2a250fbf9a3caa0ee1ce4c3898f19.json    3.69 kB │ gzip:   1.21 kB
dist/receipts/demo/31337/2-0xccbf1e23e1a1568ee2feec8086705fe7252d50f38c411deb5a9a00c982c2d884.json    3.83 kB │ gzip:   1.22 kB
dist/receipts/31337/0-0xc139451c312735428d725ce3c513c6b0aafaff870e152406968a8cd316d9fca9.json         5.41 kB │ gzip:   1.67 kB
dist/assets/market_history-fH4T4A_u.json                                                             90.34 kB │ gzip:  16.35 kB
dist/assets/index-CzPeZXa7.css                                                                       39.88 kB │ gzip:   9.70 kB
dist/assets/LandingPreview-CjsCqhs2.js                                                                2.71 kB │ gzip:   1.10 kB
dist/assets/Receipts-BAIGwKTJ.js                                                                      3.70 kB │ gzip:   1.47 kB
dist/assets/Mandate-DLnDhPG4.js                                                                       4.58 kB │ gzip:   1.99 kB
dist/assets/Desk-R1_OPuu7.js                                                                          6.40 kB │ gzip:   2.81 kB
dist/assets/Console-lR1R79Zk.js                                                                       9.09 kB │ gzip:   3.03 kB
dist/assets/ledger-streams-U9X4ypUY.js                                                               27.77 kB │ gzip:   8.48 kB
dist/assets/ledger-transport-QmNX_acP.js                                                             28.78 kB │ gzip:   8.71 kB
dist/assets/Verify-Cs4QPdp6.js                                                                       30.18 kB │ gzip:   6.03 kB
dist/assets/TimeSeriesChart-BJ_y3nfY.js                                                             166.22 kB │ gzip:  53.23 kB
dist/assets/ledger-device-BE-YRHtZ.js                                                               257.32 kB │ gzip:  69.27 kB
dist/assets/index-DG12BQuS.js                                                                       329.72 kB │ gzip:  96.18 kB
dist/assets/ledger-ethereum-CKAlsWBU.js                                                             394.87 kB │ gzip: 102.26 kB
dist/assets/chart-views-Iep3TEVg.js                                                                 445.86 kB │ gzip: 138.39 kB
```

## Data and fallbacks

| Chart | Data source | Fallback | Test file |
| --- | --- | --- | --- |
| C1 price / mandate reference | Existing Evidence history, both CEX mids; feed/on-chain receipt markers | Last 48 h frozen mainnet history; explicit unavailability | `apps/dashboard/test/chart-data.test.ts`, `charts.test.tsx` |
| C2 basis | All 720 frozen hourly mainnet rows + existing session observations | RECORDED, never an implicit demo | Same dashboard tests |
| C3 limits | Evidence vault balances, mandate caps, pinned public risk reads, existing receipts | Missing observations unavailable; undeployed 133 notice; recorded demo inputs | Same dashboard tests |
| C4 model budget | Feed state; optional seven IST days via `withSpendByDay(feed, journal.entries, now)` | Today-only bar; disconnected live feed visibly unavailable | Same dashboard tests; `packages/keeper/test/feed.test.ts` |
| C5 vault / hold after gas | Verified contiguous receipt prefixes using verifier P&L | Recorded local Anvil demo; live mode never substitutes it | Same dashboard tests |

## Browser verification

The final production routes were checked at 1440 px and 390 px. C1 canvas is visible above the fold at 1440 px. Initial mobile load has no horizontal document overflow. All twelve route/mode screenshots are under `docs/t13a-screenshots/`. The production smoke check reported no page errors.

## Interpretation and unverified checks

`bandBps` is a portfolio-weight rebalance band in the actual engine. The chart labels the dashed CEX price bands as reference levels, and its Inside/Outside chip uses the engine weight comparison. A live keeper preset is not exposed by the current feed hook, so the selector is explicitly a policy reference; recorded fixtures identify their recorded preset.

The repository's live feed hook currently returns no live keeper feed. The cost chart therefore renders a disconnected state in live mode, and the read-only keeper feed adapter supplies `spendByDay` when a real feed is connected. No provider costs or actions are fabricated.

During browser checks, complete live DEX/CEX observations and a deployed 133 mandate were unavailable. The UI showed recorded history and unavailable/undeployed states. Actual live line movement within 60 seconds remains UNVERIFIED; incremental updates are covered by mocked-library tests. Missing drawdown or trade usage stays unavailable. No profitable edge is claimed.

C6 decisions-per-day is stretch scope and is not implemented.
