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
     - `packages/core/src/abi/index.ts`: added `validUntil` signatures with backwards-compatible overloads.
     - `packages/keeper/src/execution.ts`: passes `validUntil` in transaction encoding.
     - `packages/verifier/src/verify.ts`: supports verifying both 4-arg and 5-arg calldata commitments.
   - **Testing Results:**
     - Foundry unit tests: 104 passed (including tests for valid, boundary `block.timestamp == validUntil`, and expired `validUntil`).
     - Core tests: 89 passed (1 skipped).
     - Keeper tests: 17 passed (1 skipped).
     - Verifier tests: 40 passed.
     - Dashboard tests: 31 passed.
1. **Vault guardrails** (small, careful changes; update policyHash/mandate encoding, deploy + calldata scripts, TS types and verifier together; post the new mandate fields for Engineer A, who wires them into the dashboard and desk):
   - rolling **24 h turnover cap** in the mandate;
   - **minimum interval** between agent trades;
   - **drawdown circuit breaker**: if vault value drops more than `maxDrawdownBps` below its high-water mark, agent trades revert until the owner re-signs a mandate.
   - If one of these needs a risky redesign, ship the safe ones and document the rest as a known limit.
   - **Status:** COMPLETED.
   - **Contract & Guardrail updates:**
     - `Mandate` struct: Added `uint16 maxDrawdownBps`. Validated `<= 10_000` (reverts with `InvalidMandate()`).
     - `highWaterMark`: Tracked state variable. Initialized / reset on `setMandate(m)`, ratchets up on deposits / positive portfolio gains, adjusted down on owner `withdraw` to prevent false triggers.
     - Circuit breaker: Evaluated pre-trade and post-trade in `_checkMandate` and `trade`. If total vault value (A valued in B at TWAP + B) < `highWaterMark * (10000 - maxDrawdownBps) / 10000`, reverts with `Drawdown()`.
     - Turnover cap: Enforced via `dailyTurnoverInB[dayBucket] + valueInB <= mandate.maxDailyInB` on UTC calendar-day bucket (`block.timestamp / 1 days`).
     - Minimum interval: Enforced via `block.timestamp >= lastTradeAt + mandate.minIntervalSec`.
     - Script & Calldata: `MandateCalldata.s.sol` and test updated to support `MAX_DRAWDOWN_BPS` env var (default 2000 bps / 20%).
     - Dashboard: Updated `VaultMandate` types, `Mandate.tsx`, `MandateForm.tsx` to support `maxDrawdownBps`.
2. **Fix the partial-fill bug:** router partial fills must not strand tokens (refund unspent input to the vault, or revert). Add a test. Re-check that de-risking sells still pass the exposure cap.
   - **Status:** COMPLETED.
   - `ProofTradeRouter.commitAndSwap`: Added verification asserting exact token clearance `IERC20(p.tokenIn).balanceOf(address(this)) == 0` and `amountOut >= p.amountOutMinimum`, reverting with `Underfill()` if tokens are stranded.
   - Added `MockRouter.setPartialFill` test harness and unit test `testPartialFillInputStrandingReverts` in `ProofTradeRouter.t.sol`.
   - Verified that `_assertExposureAfter` preserves the de-risking exception: exposure > `maxExposureBps` is allowed if post-trade tokenA exposure in tokenB terms strictly decreases.
   - **Testing Results:**
     - Foundry unit tests: 109 passed (0 failed).
     - Core tests: 89 passed (1 skipped).
     - Keeper tests: 17 passed (1 skipped).
     - Verifier tests: 40 passed.
     - Dashboard tests: 31 passed.
3. **Foundry invariant/fuzz tests:** agent can never withdraw or send funds anywhere except swaps back into the vault; no trading after expiry/revoke/pause or with an expired decision; per-trade cap, turnover cap, min interval and drawdown breaker enforced; random mandates never allow slippage > 100 bps.
4. Regenerate anvil fixtures from **real** anvil txs if contract changes break them.
5. `scripts/verify-blockscout.sh`: `forge verify-contract` commands for vault / router / ReceiptChain on testnet 133 and mainnet 177 (to be run after deploy).
6. Update `scripts/testnet-bootstrap.md` and the mandate calldata scripts for the new mandate fields, so Nishanth can deploy and sign with his Ledger after both PRs merge.
7. **Full practice deploy on testnet (chain 133), no Ledger** — the dress rehearsal for Nishanth's real run. Do it after your Task 9 contracts are final:
   - Use **two fresh throwaway testnet wallets** of your own: one as practice *owner*, one as practice *agent*. Fund them from https://hskchain.net/faucet (0.1 HSK/day each; ask Nishanth if you run short). Never use a wallet holding real funds; never commit keys.
   - Follow `scripts/testnet-bootstrap.md` **exactly as written**, top to bottom, substituting the throwaway owner for the Ledger. Deploy vault / router / ReceiptChain, sign the mandate with the throwaway owner, run the keeper until you get at least one real TRADE, WAIT, RESIZE and REJECT receipt, run `nalvis verify <txHash>` on each (expect PASS), then pause → revoke → confirm an agent trade reverts.
   - Run `scripts/verify-blockscout.sh` against the practice contracts.
   - **Fix the runbook** wherever a step was wrong, missing or confusing, and note gas used + HSK spent per step, so Nishanth's Ledger run is a straight copy.
   - Save results to `deployments/133-practice.json` (clearly labelled PRACTICE, throwaway owner, not the demo deployment) and `docs/PRACTICE-DEPLOY.md` (every tx hash with explorer link https://testnet-explorer.hsk.xyz, verify output, problems hit, fixes made). Only real tx hashes, never invented.
   - Chain 133 only. **Never broadcast on mainnet 177.**

### T9 acceptance
All tests green incl. new invariant tests; static dashboard build works with owner disabled; verifier PASSes regenerated real anvil fixtures; `scripts/testnet-bootstrap.md` updated; practice testnet deploy done end to end with real receipts that verify PASS, documented in `docs/PRACTICE-DEPLOY.md`.



---

## 3. Daily check-in
Post in the team chat at 10:00 and 21:00 IST: what's merged, what's blocked, next step. If blocked > 1 hour, tell Nishanth immediately.
