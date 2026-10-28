# AGENTS.md: Nalvis-HSK (Edgewise × ProofTrade)

This file is for coding agents (Codex Cloud and others). Read all of it before changing anything. The other key docs are `docs/PLAN.md` (milestones and acceptance criteria), `docs/ADDRESSES.md` (the only allowed addresses) and `docs/CODEX_ENV.md` (environment setup).

## 1. What we are building

We are building a **Ledger-governed, receipt-proving trading agent** on HashKey Chain for the HSK Chain Horizon Hackathon, Track 1.

1. **Mandate.** The owner signs a mandate on a Ledger. The mandate holds the agent key, expiry, size, daily and exposure caps, a slippage cap and a minimum interval. It also holds the `policyHash`, which is the keccak256 of the canonical policy JSON. The owner can `revoke` the mandate at any time, and after that the agent cannot trade.
2. **Decisions.** A keeper runs a deterministic decision engine on a live evidence pack and gets one of `TRADE | RESIZE | WAIT | REJECT`.
3. **Receipts on-chain.** Every decision becomes a hash-chained on-chain receipt:
   - TRADE and RESIZE go through `trade(...)`, which records the receipt and swaps atomically through HSKSwap SwapRouter02.
   - WAIT and REJECT go through `commitHold(...)`, which records the receipt with no swap.
4. **Verifier.** A verifier CLI lets anyone re-hash the evidence, replay the engine, match the on-chain receipt, and compute realised slippage, fees, gas and P&L.
5. **Dashboard.** A small React dashboard shows the mandate, live evidence, decisions, receipts and verification. It also hosts the Ledger owner actions.

**The strategy is honest.** The strategy is cost-aware rebalancing toward a target weight. It is gated by the gap between the HSKSwap price and the CEX price: trade only in the direction the basis favours, and only when the edge is greater than the measured cost at that size. The research backtest shows **no proven edge** (see §6), and the product does not claim profit. It sells **bounded, provable execution**.

### The LLM's role (strict)

The LLM is optional and boxed in:

- It may **(a)** choose one strategy preset from a fixed enum defined in the policy file, **(b)** write plain-language explanations of decisions, and **(c)** turn a natural-language request into a parameter diff that is validated against the schema and the mandate.
- It must **never** set prices, amounts, minOut or recipients. It must never build, sign or send a transaction, and it must never change the engine's verdict.
- All LLM output is schema-validated (zod), and the transcript hash goes into the receipt.
- Everything must work with **no LLM key**, using a deterministic fallback with templated explanations. Tests never call a real LLM.

## 2. Architecture and repo layout (target)

```
contracts/                 Foundry project (solc 0.8.24, optimizer 200 runs)
  src/ReceiptChain.sol     abstract: seq, head, Receipt event, prevHead check
  src/EdgewiseVault.sol    owner (Ledger) + mandate + trade() + commitHold() + revoke/withdraw
  src/ProofTradeRouter.sol fallback product: keeper-wallet commitAndSwap()/commitHold() + setPolicy(hash)
  src/interfaces/          minimal ISwapRouter02 (IV3SwapRouter), IUniswapV3Pool, IQuoterV2, IAggregatorV3, IERC20
  src/lib/                 0.8-compatible TickMath/FullMath ports (check license; note it in README)
  test/                    unit tests (local mocks) + fork tests (mainnet 177 fork, testnet 133 fork)
  script/                  Deploy.s.sol (testnet 133 only), SetMandate calldata helper
packages/core/             TS: types, canonical JSON, hashing, policy schema, evidence pack, decision engine, backtest
packages/keeper/           TS: loop that reads evidence, runs engine, writes receipt JSON, submits tx (testnet/fork only)
packages/verifier/         TS CLI: verify <txHash|receipt.json>
apps/dashboard/            React 19 + Vite + viem; Ledger owner actions via @ledgerhq/device-management-kit (WebHID)
data/research/             frozen research fixtures (market_history.json, backtest.json, ...) — read-only inputs for tests
receipts/                  generated receipt JSON (gitignored except committed demo examples)
docs/                      PLAN, ADDRESSES, CODEX_ENV
```

TypeScript uses a pnpm workspace, Node 22, TypeScript strict mode, `viem` for chain access, `vitest` for tests and `zod` for schemas. Do not add ethers or web3.js.

### Contract spec (summary; tests must cover every bullet)

**`ReceiptChain` (abstract)**

- It holds `uint64 seq` and `bytes32 head`.
- `_commit(receiptHash, prevHead, kind, ...)` requires `prevHead == head`. It then sets `head = keccak256(abi.encode(head, receiptHash, seq))`, increments `seq` and emits the `Receipt` event.
- `kind` is an enum: `TRADE, RESIZE, WAIT, REJECT`.
- `event Receipt(uint64 indexed seq, bytes32 indexed receiptHash, bytes32 prevHead, bytes32 policyHash, uint8 kind, address tokenIn, uint256 amountIn, uint256 amountOut, uint256 minOut, uint256 refOut)`. Hold receipts use zeros for the token and amount fields.

**`EdgewiseVault is ReceiptChain`**

- **Constructor** takes `(owner, router, pool, tokenA=WHSK, tokenB=USDT, fee, twapWindowSec, oracle /*may be 0*/, oracleBandBps, oracleMaxAge)`. Everything structural is immutable.
- **No initializer** and no first-caller setup functions.
- **Owner-only**:
  - `setMandate(Mandate)` with fields `{agent, expiry, maxTradeInA, maxTradeInB, maxDailyInB, maxExposureBps, maxSlippageBps, minIntervalSec, policyHash}`.
    - `maxSlippageBps <= MAX_SLIPPAGE_CAP_BPS` (a constant of 100), `expiry > now`, and `agent != owner`.
    - Every change emits `MandateSet`.
  - `revoke()`, which zeroes the agent immediately.
  - `withdraw(token, amount, to)`, `pause()` and `unpause()`.
- **Agent-only `trade(TradeParams)`** with fields `{tokenIn, amountIn, minOut, deadline, nonce, receiptHash, prevHead, kind}`. It checks:
  - not paused, the mandate is live, and `block.timestamp <= deadline`;
  - `nonce == nextNonce`;
  - `now >= lastTradeAt + minIntervalSec`;
  - `amountIn` is within the per-token cap;
  - the rolling 24 h notional in tokenB terms is within `maxDailyInB`;
  - post-trade exposure is within `maxExposureBps`.

  It then computes `refOut` from the pool TWAP via `observe([twapWindowSec, 0])` and requires `minOut >= refOut * (10_000 - maxSlippageBps) / 10_000`.
  - If an oracle is configured, the TWAP price must also be within `oracleBandBps` of the oracle, and the oracle must not be older than `oracleMaxAge`. Fail closed: if `observe` reverts, `trade` reverts.
  - It approves the **exact** `amountIn` to the router, calls `exactInputSingle` with `recipient = address(this)`, then **resets the allowance to 0**.
  - Finally it asserts `amountOut >= minOut` and emits the Receipt.

- **Agent-only `commitHold(receiptHash, prevHead, kind)`**, where kind is WAIT or REJECT. It records the receipt without moving funds.
- **Deposits** are plain ERC-20 transfers or `deposit(token, amount)` with `transferFrom` for an exact pre-approved amount. The vault never asks for unlimited approval.

**`ProofTradeRouter is ReceiptChain`** is the fallback product if the Ledger/vault path is cut.

- It has an `owner` set in the constructor and an owner-only `setPolicy(bytes32)`.
- `commitAndSwap(receiptHash, prevHead, ExactInputSingleParams, deadline)` pulls the exact `amountIn` from the caller, approves exactly, swaps to the caller, resets the approval and emits the Receipt.
- `commitHold(receiptHash, prevHead, kind)`.
- It is permissionless per caller, but each caller has its own `seq` and `head`.

### Off-chain spec (summary)

**Policy file** (`policy/*.json`): a zod schema with canonical JSON (RFC 8785 / JCS-style sorted keys, no whitespace), where `policyHash = keccak256(utf8(canonical))`. It contains:

- presets (`conservative | balanced | patient`) for target weight, rebalance band, edge buffer, clip sizes and cool-down;
- data-quality limits for DEX staleness, CEX freshness, APRO band and age, and maximum quote deviation;
- a daily loss stop.

**Evidence pack**, gathered at one block number. Mainnet 177 reads are read-only.

- Pool `slot0`, liquidity and token balances.
- QuoterV2 `quoteExactInputSingle` in both directions for a size grid (e.g. 10/25/50/100 USDT).
- The last swap timestamp from the subgraph.
- MEXC and Gate book tickers.
- APRO `latestRoundData`, with its age.
- Vault balances and mandate.
- Timestamps, source URLs and raw responses.

The evidence hash is `evidenceHash = keccak256(canonical(evidence))`.

**Decision engine**: a pure function `decide(evidence, policy, mandate, state) -> {kind, size, direction, minOut, ruleTrace[]}`. It has no I/O, no clock reads (time comes from evidence) and no randomness.

- **REJECT**: any data-quality or risk failure, any mandate breach that can't be fixed by resizing, or an invalid LLM proposal.
- **WAIT**: the data is fine, but the weight is within the band or the edge is ≤ 0 after the measured cost at the chosen size.
- **RESIZE**: the desired size breaks a cap, or only a smaller grid size has a positive edge. Choose the largest valid size.
- **TRADE**: otherwise.
- `edge = |basis| - oneWayCost(size) - buffer`, where `oneWayCost` comes from live QuoterV2 versus pool mid. Never hard-code cost numbers outside tests.

**Receipt JSON** is `{version, chainId, contract, seq, prevHead, policyHash, evidenceHash, evidence, decision, ruleTrace, llm:{model?, promptHash?, outputHash?, explanation}, tx:{to, data, minOut, deadline, nonce}}`, with `receiptHash = keccak256(canonical(receipt without tx fields that depend on the hash))`. Document the exact field list in `packages/core/README.md` and freeze it with a golden-file test.

**Two chains.** Market data and decisions come from **mainnet 177 (read-only, "shadow")**. Execution happens on **testnet 133** or on a **local anvil fork of 177**. Every receipt carries `marketDataChainId` and `executionChainId`, and the UI and CLI label testnet results "testnet: prices are not real".

## 3. HARD RULES (never break these)

1. **Never broadcast to chain 177 (mainnet).** Mainnet is read-only: `eth_call`, `eth_getLogs` and subgraph queries only.
   - Every wallet or signing code path must assert `chainId ∈ {133, 31337}` and throw otherwise.
   - Forge scripts must `require(block.chainid == 133 || block.chainid == 31337)`.
   - Enabling mainnet later needs a separate, human-approved PR.
2. **No real funds.** Test HSK on 133 and anvil forks only.
3. **No private keys in code, tests, fixtures, logs, commits or PR text.**
   - Keys come only from env vars at runtime on the developer's machine (see `docs/CODEX_ENV.md`).
   - Tests use anvil's well-known dev keys or `vm.addr`/`makeAddr`.
   - `.env` is gitignored, and you must never print env values.
   - **Codex Cloud tasks never receive private keys.** Testnet broadcasting is done locally by the human.
4. **Separate keys and roles.** owner (a Ledger address, public), deployer (testnet hot key) and agent/keeper (testnet hot key) must be three different addresses. The deploy script and keeper must refuse to run if any two are equal. The deployer has **no** privileges after deployment.
5. **Fix the known Ledger-Guardian-Agent (LGA) holes.** Do not copy these patterns from https://github.com/n1shanthb/Ledger-gaurd (public reference repo):
   - A permissionless price-feed setter: GuardianPolicyManager `setPriceFeed`. Here the oracle address is a constructor immutable and there is no setter.
   - `approve(type(uint256).max)`: keeper `policyTx.ts`. Use exact-amount approvals, and reset them to 0 after use.
   - A max slippage of 9,999 bps: GPM L25. Our cap is a constant of 100 bps.
   - First-caller `setManager`/`setValidator` (setup front-running). Use constructor-set roles only.
   - Keeper key = deployer key. See rule 4.
   - A session key with no expiry or scope. Our mandate has an expiry, caps, a pair allowlist and a fixed recipient (`address(this)`).
   - `overrideExecute` bypass paths and one-shot `executePolicy`. There is no bypass, and every trade goes through the same checks.
6. **Addresses.** Use only addresses in `docs/ADDRESSES.md`, imported from one config module (`packages/core/src/addresses.ts` and `contracts/script/Addresses.sol`). Never invent an address, ABI, endpoint or number. If something is unknown, label it `UNVERIFIED` in code comments and docs, and make it fail closed.
7. **Decimals:** USDT has 6 decimals on 177 and 18 on 133. Never assume them; read `decimals()` or use the address config.
8. **Honesty in copy.** Never claim profit or alpha. Label testnet prices as fake and the backtest as "no proven edge". Ledger signing on 133 is **blind signing** (there is no clear-signing descriptor for chain 133/177), so say so in the UI.
9. **The LLM never touches execution** (see §1).
10. **Do not touch** git history or branch protection, and do not create releases or publish packages. Open a PR; never push directly to `main`.

## 4. Commands

```bash
# contracts
cd contracts && forge build && forge test -vvv
forge test --match-path 'test/fork/*' --fork-url "$HSK_MAINNET_RPC"   # mainnet-fork tests (read-only fork)
forge test --match-path 'test/forkTestnet/*' --fork-url "$HSK_TESTNET_RPC"
# typescript (repo root)
pnpm install && pnpm -r build && pnpm test        # vitest across packages
pnpm lint                                          # eslint + tsc --noEmit
```

The definition of done for any PR:

- `forge test` and `pnpm test` pass.
- No new address is used without a `docs/ADDRESSES.md` entry.
- No secrets appear anywhere.
- The PR description lists what was verified and what is still UNVERIFIED.

Fork tests need network access to the RPCs (see `docs/CODEX_ENV.md`). If the network is unavailable, fork tests must **skip with a clear message**, not fail silently or fake results. Unit tests must run fully offline.

## 5. Conventions

- **Solidity:** custom errors, NatSpec on external functions, checks-effects-interactions, `nonReentrant` on functions that move funds, no `tx.origin`, no `delegatecall`, no upgradeability.
- **Minimal interfaces:** write these in `src/interfaces` rather than importing Uniswap periphery, which is solc 0.7.
- **TypeScript:** pure engine modules have no I/O. Use `bigint` for on-chain amounts, and `number` only for display or percentages. Every external response is validated with zod.
- **Times:** store UTC unix seconds. Display in IST (Asia/Kolkata) with a label.
- **Small PRs:** one task per PR.

## 6. Research facts (from data/research; do not re-derive or inflate)

- **Primary mainnet pool** WHSK/USDT 0.3%. Over the 30-day window ending 27 Oct 2026:
  - 1,883 swaps, with at least one swap in only 204 of 720 hours;
  - 97.6% of swaps came from one EOA.
- **Measured QuoterV2 round-trip cost** (27 Oct, 21:30 IST): $10 = 0.608%, $50 = 0.643%, $100 = 0.688%, $500 = 1.041%, $1k = 1.480%. One-way at $100 is about 0.345%. Swap gas is about 116–135k, about $0.005–0.006 at 500 gwei.
- **DEX-vs-CEX basis:** median +0.07%, stdev 1.30%. |basis| > 0.69% in 25% of hours and > 1% in 13%. Reversion is slow.
- **Backtest** (`data/research/backtest_reference.py` → `backtest.json`): $1k at 50/50, $100 clips, out-of-sample, marked at the DEX price.

  | Strategy        | Excess vs hold | Trades | Rejected |
  | --------------- | -------------- | ------ | -------- |
  | Fixed band      | −$16.61        | 4      | 0        |
  | Risk-aware band | −$17.38        | 8      | 8        |
  | Dislocation     | **+$0.49**     | 38     | 93       |

  This is break-even, with **no proven edge**.

- **APRO** updates rarely (it was 20.8 h stale on 28 Oct). Pyth is absent. Testnet prices are fake (about 54–78 USDT/WHSK).

## T2 implementation notes

- A normal call from a deployed `AproReader` to APRO `latestRoundData()` at
  mainnet block `29413000` reverted (no EOA prank). Fork vaults therefore use
  `oracle = address(0)`, as required by the T2 review follow-up. APRO remains
  off-chain keeper/verifier evidence only. MockAggregator tests cover age,
  incomplete rounds, future timestamps, invalid answers, and price bands.
- Daily notional uses UTC calendar-day buckets (`block.timestamp / 1 days`),
  not a sliding window. Mandate updates/revocation do not reset spend or nonces.
- Exposure means the proportion of total pair value held in tokenA, with both
  balances valued in tokenB at the same TWAP tick. TokenB is assumed to track USD
  when comparing the optional tokenA/USD oracle; that peg is UNVERIFIED.
- ProofTradeRouter takes `(owner, router)` in its constructor, fixing the swap
  destination. ReceiptChain shares commitment logic through a storage `Chain`:
  one instance in the vault, one per caller in the router. Events use the
  pre-increment sequence number, starting at zero.

## T3 implementation notes

- Deployment uses the CLI-selected broadcaster, never an env private key read in
  Solidity. Set DEPLOY_COMMIT to `git rev-parse HEAD` before running. Manifests
  record the simulation block; verify both mined receipts before using them.
- Exposure above the mandate cap is allowed only on strict risk reduction,
  comparing pre/post tokenB values at the same TWAP without rounding to bps.
- ProofTradeRouter rejects nonzero sqrtPriceLimitX96 to require full input use.
- MandateCalldata hashes exact policy/default.json bytes (canonical JSON is the
  policy file convention); a missing file warns and uses zero. Read-only helpers
  refuse chains outside 133/31337. See scripts/testnet-bootstrap.md.

## Workflow implementation notes

Workflow: commit and push to the task branch after each submodule or logical unit of change; open the PR once when acceptance tests pass
