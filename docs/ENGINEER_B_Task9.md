# Nalvis-HSK — Engineer B brief: Task 9 (contract guardrails, expiry, invariant tests, practice testnet deploy)

**Project:** Nalvis — an autonomous, verifiable AI trading agent on HSKSwap (HashKey Chain). It decides TRADE / WAIT / RESIZE / REJECT from market evidence, trades only inside a Ledger-signed on-chain mandate, and writes a hash-chained receipt for every decision that anyone can verify.
**Hackathon:** HSK Chain Horizon Hackathon, Track 1 (AI Agent Trading). **Hard deadline: Nov 1, 2026, 21:30 IST** (no late entries).
**Repo:** https://github.com/n1shanthb/Nalvis-HSK (private — ask Nishanth for access).
**Owner / reviewer:** Nishanth. Every change goes through a PR he approves.
**Not in scope for you:** Ledger testing and the final Ledger-owned testnet deploy (Nishanth does those, he holds the Ledger) and Task 10 docs/video/submission (starts after both engineers finish).

## 0. Ground rules (read first)

1. **Never push to `main`.** Create a branch per task (`t8-desk-ui`, `t9-guardrails`), push often, open a PR. Main is protected; a restore point exists at branch `checkpoint-t7`.
2. **Commit after every submodule / logical unit** (one view, one contract change, one test group), with a clear message. No single giant commit at the end.
3. **Read `AGENTS.md` and `docs/ADDRESSES.md` before coding.** Only use contract addresses listed in `docs/ADDRESSES.md`.
4. **Honesty rules:** never fabricate tx hashes, addresses, prices, screenshots or test results. If something couldn't be run, say so in the PR as **UNVERIFIED**. No "guaranteed profit" / alpha claims — the backtest shows *no proven edge*.
5. **Never broadcast on mainnet (chain 177).** Mainnet is read-only. Writes go to testnet 133 or a local anvil fork only.
6. **Never commit private keys, mnemonics or `.env` files.** Use your own fresh testnet-only wallet.
7. CI must be green (`forge test`, `pnpm test`, `pnpm lint`, `pnpm build`) before asking for review.

## 1. Prerequisites (set up tonight)

| Need | How |
|---|---|
| GitHub access | Send Nishanth your GitHub username; accept the invite to `n1shanthb/Nalvis-HSK`. |
| Node 22 + pnpm 9 | `nvm install 22 && corepack enable && corepack prepare pnpm@9 --activate` |
| Foundry | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` (forge, anvil, cast) |
| Repo setup | `git clone git@github.com:n1shanthb/Nalvis-HSK.git && cd Nalvis-HSK && pnpm install && forge build && pnpm test` — all green before you start |
| Mainnet RPC (read-only) | `https://mainnet.hsk.xyz` (chain 177) — for fork tests and live evidence |
| Testnet RPC | `https://testnet.hsk.xyz` (chain 133), explorer https://testnet-explorer.hsk.xyz |
| Testnet wallet | Make a **new** MetaMask account just for testnet. Add chain 133. Claim test HSK at https://hskchain.net/faucet (0.1 HSK per 24 h, reCAPTCHA). Never reuse a wallet that holds real funds. |
| Docs | HSK docs https://hskchain.net/docs · mainnet explorer https://hsk.blockscout.com |

Useful repo files: `AGENTS.md` (rules), `docs/PLAN.md`, `docs/ADDRESSES.md`, `scripts/testnet-bootstrap.md` (deploy runbook), `apps/dashboard/README.md`, `docs/T7-VERIFICATION.md`.

Local dashboard: `VITE_ENABLE_OWNER=false pnpm --filter @nalvis/dashboard dev` → http://localhost:5173

---

## Working in parallel with the other engineer
Engineer A does **Task 8** (agent, desk, UI). Engineer B does **Task 9** (contracts, guardrails). You both start from current `main` today.
- **Ownership:** B owns `contracts/` / Solidity, Foundry tests, deploy scripts and the mandate/policy encoding. A owns `apps/dashboard`, `packages/core/src/desk`, the decision engine and keeper. Don't edit the other's area; if you need a change there, ask them.
- **Shared types / verifier** (`packages/core` types, `packages/verifier`): keep changes small and tell the other person in chat before you push.
- **Integration order:** B merges first (contracts), then A rebases on `main`, wires the new mandate fields + on-chain expiry into the dashboard/desk/verifier, and merges.
- Rebase on latest `main` before opening your PR; resolve conflicts yourself; CI must be green.

## 2. Task 9 — Guardrails, invariant tests, deploy tooling
**Target: contracts PR open by Oct 30, 18:00 IST** (A rebases on it after); **practice deploy done by Oct 31, 12:00 IST** (separate small PR is fine). Branch `t9-guardrails` (start from current `main` today, in parallel with Task 8). PR title: `T9: guardrails + invariant tests + verify/deploy tooling`.

0. **On-chain decision expiry:** trade call takes `validUntil`; vault/router reverts if `block.timestamp > validUntil`. Foundry tests. Tell Engineer A the new function signature as soon as it's fixed.
   - **Status:** COMPLETED.
   - **Contract ABI updates:**
     - `EdgewiseVault.TradeParams`: added `uint256 validUntil` field. Reverts with `DecisionExpired()` if `block.timestamp > validUntil`.
     - `ProofTradeRouter.commitAndSwap`: updated signature to `commitAndSwap(bytes32 receiptHash, bytes32 prevHead, ExactInputSingleParams calldata p, uint256 validUntil, uint256 deadline)`. Reverts with `DecisionExpired()` if `block.timestamp > validUntil`.
   - **TypeScript & ABI Support:**
     - `packages/core/src/abi/index.ts`: updated vault/router signatures and added the rolling-turnover getter.
     - `packages/keeper/src/execution.ts`: passes `validUntil` in transaction encoding.
     - `packages/verifier/src/verify.ts`: receipt schema and independent canonical hashing include `validUntil`; decoded calldata is checked against the receipt.
   - **Testing Results:**
     - Current complete test results are recorded in the "Final Task 9 recheck" section below.
1. **Vault guardrails** (small, careful changes; update policyHash/mandate encoding, deploy + calldata scripts, TS types and verifier together; post the new mandate fields for Engineer A, who wires them into the dashboard and desk):
   - rolling **24 h turnover cap** in the mandate;
   - **minimum interval** between agent trades;
   - **drawdown circuit breaker**: if vault value drops more than `maxDrawdownBps` below its high-water mark, agent trades revert until the owner re-signs a mandate.
   - If one of these needs a risky redesign, ship the safe ones and document the rest as a known limit.
   - **Status:** COMPLETED.
   - **Contract & Guardrail updates:**
     - `Mandate` struct: Added `uint16 maxDrawdownBps`. Validated `<= 10_000` (reverts with `InvalidMandate()`).
     - `highWaterMark`: Tracked state variable. Initialized / reset on `setMandate(m)`, ratchets up on deposits / positive portfolio gains, adjusted down on owner `withdraw` to prevent false triggers.
     - Circuit breaker: Evaluated before and after each trade. If total vault value (A valued in B at TWAP + B) < `highWaterMark * (10000 - maxDrawdownBps) / 10000`, reverts with `Drawdown()`.
     - Turnover cap: Enforced against `maxDailyInB` over a rolling 24-hour window using 48 half-hour buckets.
     - Minimum interval: Enforced via `block.timestamp >= lastTradeAt + mandate.minIntervalSec`.
     - Script & Calldata: `MandateCalldata.s.sol` and test updated to support `MAX_DRAWDOWN_BPS` env var (default 2000 bps / 20%).
     - Dashboard: Updated `VaultMandate` types, `Mandate.tsx`, `MandateForm.tsx` to support `maxDrawdownBps`.
2. **Fix the partial-fill bug:** router partial fills must not strand tokens (refund unspent input to the vault, or revert). Add a test. Re-check that de-risking sells still pass the exposure cap.
   - **Status:** COMPLETED.
   - `ProofTradeRouter.commitAndSwap`: Requires the post-swap input balance to equal its pre-swap balance and `amountOut >= p.amountOutMinimum`, reverting with `Underfill()` if input is stranded.
   - Added `MockRouter.setPartialFill` coverage, including tests proving partial fills revert atomically and preserve pre-funded router dust.
   - Verified that `_assertExposureAfter` preserves the de-risking exception: exposure > `maxExposureBps` is allowed if post-trade tokenA exposure in tokenB terms strictly decreases.
   - **Testing Results:**
     - Current complete test results are recorded in the "Final Task 9 recheck" section below.
3. **Foundry invariant/fuzz tests:** agent can never withdraw or send funds anywhere except swaps back into the vault; no trading after expiry/revoke/pause or with an expired decision; per-trade cap, turnover cap, min interval and drawdown breaker enforced; random mandates never allow slippage > 100 bps.
   - **Status:** COMPLETED.
   - Invariant test suite: `contracts/test/invariant/VaultInvariant.t.sol` + `VaultHandler.sol`.
     - **12 invariants:** vault custody, router allowance always zero, slippage cap ≤ 100 bps, drawdown cap, owner preserved, rolling turnover cap, receipt/nonce integrity, min interval, inactive mandate, expired decision, per-trade cap and drawdown breaker.
     - VaultHandler drives 10 handler actions: trade (including intentionally expired validUntil), commitHold, agentAttemptWithdraw, strangerActions, deposit, ownerWithdraw, setPaused, revoke, warp and attemptSetMandate.
   - Fuzz test suite: `contracts/test/unit/VaultFuzz.t.sol`.
     - 7 fuzz tests: mandate slippage/drawdown caps, decision expiry, per-trade cap, rolling turnover across midnight, minimum interval and agent withdrawal denial.
   - Added `getMandate()` external view helper to `EdgewiseVault.sol` so test contracts can read the full struct (Solidity public struct getter returns a tuple, not the struct type).
   - **Testing Results:**
     - Current complete test results are recorded in the "Final Task 9 recheck" section below.
4. Regenerate anvil fixtures from **real** anvil txs if contract changes break them.
5. `scripts/verify-blockscout.sh`: `forge verify-contract` commands for vault / router / ReceiptChain on testnet 133 and mainnet 177 (to be run after deploy).
   - **Status:** COMPLETED.
   - Script reads `deployments/133.json` (and optionally `177.json`) for deployed addresses.
   - Encodes exact constructor args via `cast abi-encode` and calls `forge verify-contract --verifier blockscout`.
   - **UNVERIFIED:** Blockscout verifier URL for chain 133 (`https://testnet-explorer.hsk.xyz/api/`) not confirmed in a live run. API key may or may not be required.
6. Update `scripts/testnet-bootstrap.md` and the mandate calldata scripts for the new mandate fields, so Nishanth can deploy and sign with his Ledger after both PRs merge.
   - **Status:** COMPLETED.
   - Updated `mandate()` cast call ABI to include new `maxDrawdownBps` field (10-element tuple).
   - Added `highWaterMark()` read after trade in §5.
   - Added mandate field reference section documenting `maxDrawdownBps`, `maxSlippageBps`, `minIntervalSec`, `maxDailyInB`.
   - `MandateCalldata.s.sol` already updated in Phase 1 to read `MAX_DRAWDOWN_BPS` env var (default 2000).
7. **Full practice deploy on testnet (chain 133), no Ledger** — the dress rehearsal for Nishanth's real run. Do it after your Task 9 contracts are final:
   - The configured temporary deployment owner is `0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927`; the intended final owner is Nishanth's Ledger address, to be supplied and independently verified later.
   - Both contracts use two-step ownership transfer. After deployment, the temporary owner must call `transferOwnership(LEDGER_ADDRESS)` on each contract, and Nishanth must call `acceptOwnership()` on each contract from the Ledger. These are four separate owner-authorized transactions; verify each `owner()` and cleared `pendingOwner()` before configuring the mandate.
   - Follow `scripts/testnet-bootstrap.md` only after that ownership blocker is resolved. Never use a wallet holding real funds; never commit keys.
   - Run `scripts/verify-blockscout.sh` against the practice contracts.
   - **Fix the runbook** wherever a step was wrong, missing or confusing, and note gas used + HSK spent per step, so Nishanth's Ledger run is a straight copy.
   - Save results to `deployments/133-practice.json` (clearly labelled PRACTICE, throwaway owner, not the demo deployment) and `docs/PRACTICE-DEPLOY.md` (every tx hash with explorer link https://testnet-explorer.hsk.xyz, verify output, problems hit, fixes made). Only real tx hashes, never invented.
   - Chain 133 only. **Never broadcast on mainnet 177.**
   - **Status:** PENDING — Two-step ownership handover is implemented in both contracts; practice deployment and handover remain pending.

### Review Resolutions & Implementation Summary

1. **Router Dust Griefing / DoS Prevention:**
   - Modified `ProofTradeRouter.sol` to record pre-transfer balance `balBefore` and require post-swap balance `balAfter == balBefore`, instead of asserting `balance == 0`.
   - Protects against external dust transfers permanently DoS-ing caller swaps.
   - Reverts atomically without refunding pre-existing dust to callers.

2. **Owner Withdrawal TWAP Dependency:**
   - Updated `EdgewiseVault.sol` to use `_tryTick()` with `try/catch pool.observe()`.
   - Withdrawals transfer funds first and adjust `highWaterMark` best-effort proportionally (`highWaterMark = FullMath.mulDiv(highWaterMark, totalAfter, totalBefore)`).
   - Prevents reverting TWAP reads from locking owner funds, while preserving existing drawdown.
   - Deposits increment `highWaterMark += depVal` to prevent false profit or drawdown erasure.

3. **Documented Drawdown Breaker Default:**
   - Updated `MandateCalldata.s.sol` to read `MAX_DRAWDOWN_BPS` from environment with default 2000 bps (20%).
   - Calldata test verifies both default 2000 bps and explicit values within allowed bounds `<= 10000`.

4. **Genuine Rolling 24-Hour Turnover:**
   - Replaced calendar-day bucketing with 48 30-minute ring buffer slots (`TurnoverSlot[48] private _turnoverSlots`).
   - `getRolling24hTurnover()` sums slots within 48 half-hour epochs.
   - Prevents midnight boundary reset bypass and mandate replacement reset bypass.
   - Failed trades do not consume turnover.

5. **Strengthened Stateful Foundry Invariants:**
   - Removed tautological invariants (such as `seq >= 0`).
   - Added 11 stateful invariants:
     1. Agent cannot hold vault funds.
     2. Stranger cannot hold vault funds.
     3. Minimum interval strictly enforced between trades.
     4. Inactive/revoked/paused mandate never trades.
     5. Drawdown breaker blocks agent trades once triggered.
     6. Per-trade cap enforced.
     7. Slippage never exceeds 100 bps.
     8. Router token allowance always zero after execution.
     9. Failed transactions do not advance nonce or receipt state.
     10. Rolling turnover cap strictly preserved.
     11. Owner immutable preserved.
   - Verified across 256 runs and 128,000 handler calls with 0 failures.

6. **Regenerated Anvil Fixtures & Verifier Compatibility:**
   - Cleaned up obsolete legacy ABI overloads in `packages/core/src/abi/index.ts`.
   - Regenerated real Anvil fork fixtures with updated ABIs and preserved transaction hashes.
   - Keeper receipts now populate a separate, hash-committed `validUntil`; executor calldata passes it explicitly.
   - All 40 verifier tests, 89 core tests, 17 keeper tests, and 31 dashboard tests pass.

7. **Practice Deployment Preparation:**
   - Nishanth will not supply wallet credentials.
   - Two separate testnet-only wallets under Prithiv's control are prepared (Practice Owner and Practice Agent).
   - Rehearsal scripts ready for execution upon Prithiv's explicit broadcast authorization.

**Completed Phases:**
- [x] Phase 0: Decision expiry (`validUntil`)
- [x] Phase 1: Drawdown circuit breaker & partial-fill protection
- [x] Phase 2: Invariant & fuzz test suite
- [x] Phase 3: Review blockers resolved (dust griefing, TWAP withdrawal resilience, rolling 24h turnover, calibrated calldata)
- [x] Phase 4: Regenerated Anvil fixtures & legacy ABI cleanup
- [x] Phase 5: Local HSK Testnet fork rehearsal for TRADE, RESIZE, WAIT, REJECT and pause/revoke reverts (13 tests pass; no broadcast).
- [ ] Live chain-133 practice receipts remain blocked by zero vault token balances and the need for explicit owner/agent transaction authorization. No Ledger transfer or real Testnet execution was performed.

## Final Task 9 recheck (1 Nov 2026)

- Added rolling 24-hour turnover to off-chain engine state handling and keeper
  reads; UTC midnight no longer resets the turnover guard. The on-chain ring
  buffer now stores full-width `uint256` notionals.
- `validUntil` is committed in new receipt hashes and verified independently
  against vault/router calldata. Historical receipts without that field remain
  supported using their deadline as the prior expiry value.
- Dashboard mandate review validates the drawdown cap and displays turnover as
  a rolling 24-hour limit. ABI exports and deployment/bootstrap read commands
  include `getRolling24hTurnover()`.
- Verification results: `forge test` 155 passed / 1 optional fork skip;
  chain-133 fork integration 13/13 passed; `pnpm test` 181 passed / 2 optional
  RPC skips; `pnpm -r build`, `pnpm lint` and `forge fmt --check` passed.
- No Testnet transaction, funding, owner change, or Ledger interaction was
  initiated. Fork receipts are simulations and must not be presented as mined
  chain-133 evidence.



---

## 3. Daily check-in
Post in the team chat at 10:00 and 21:00 IST: what's merged, what's blocked, next step. If blocked > 1 hour, tell Nishanth immediately.
