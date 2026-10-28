# T2 verification

Base: latest main fetched before implementation, `a242719` (T1, PR #1).
Toolchain: Foundry 1.5.1, native solc 0.8.24, optimizer 200; pnpm 9.15.9.
Verified on 28 October 2026. No deployment or broadcast was performed.

- `forge test -vvv`: **94 passed, 0 failed, 1 skipped** (95 tests).
  Both real swap tests and the APRO contract probe passed on chain 177 fork,
  block **29413000**. USDT funding with forge-std `deal()` worked; the documented
  pool-holder transfer fallback was not needed.
- The single skip is the real-APRO freshness test: ordinary calls from a
  deployed `AproReader` reverted. The vault correctly uses oracle zero under
  the TASK2 additional requirement. The MockAggregator freshness failure test
  passes and requires no RPC. If APRO becomes contract-callable at another block,
  the harness tries **604800 seconds (7 days)** and tests **0 seconds** separately.
- `forge coverage --report summary --no-match-coverage
  '(src/lib/(TickMath|FullMath)\.sol|test/|script/)'`: **100% src line coverage
  (169/169)**. Vault 121/121, router 24/24, receipt chain 9/9, mutex 4/4,
  SafeToken 11/11. Statements 265/265, reported branches 38/38, functions 30/30.
  Only the two upstream math ports are excluded from src coverage. Test and
  script paths are excluded from the denominator. Math ports have vector and
  fuzz tests and run in the real fork swaps.
- `forge build --sizes`: EdgewiseVault **11426 bytes** runtime / 13673 initcode;
  ProofTradeRouter **2988 bytes** runtime / 3257 initcode. Both below 24576 bytes.
- Fork-only `forge test --match-contract VaultForkTest --match-test
  testReal50USDTTrade --gas-report -vv`: **320312 gas per trade()**, one sample,
  real 50 USDT to WHSK through SwapRouter02. This is the Forge function report;
  the gasleft instrumentation in that same report logs call-boundary gas
  separately. This is a local fork execution, not a broadcast transaction fee.
- `bash scripts/check-rules.sh`: pass. The compiled ABIs also have no
  oracle/router/pool/token setters or initializer.
- `pnpm test`: **7 tests passed across 4 packages**. Workspace and lockfile
  unchanged. CI runs the rules script, Forge tests/coverage/sizes and pnpm tests.

## UNVERIFIED assumptions and limits

- USDT's USD peg when the optional HSK/USD oracle is enabled.
- Future APRO caller permissions, heartbeat/freshness and availability; no
  claim that the inaccessible oracle provides on-chain protection.
- Fee-on-transfer/rebasing assets are unsupported; verified immutable pair and
  router implementations are trusted. Mainnet execution is not authorized.
- A single pinned fork block and gas sample do not establish future liquidity,
  gas costs, economic edge or profitability. No proven edge is claimed.
- UTC daily buckets permit two caps around midnight; they are not sliding 24h
  windows. Exposure is tokenA's share of total tokenB-denominated pair value.
- Ledger flow, deployment and live testnet execution are outside T2 and untested.
