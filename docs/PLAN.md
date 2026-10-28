# PLAN: Nalvis-HSK (Edgewise × ProofTrade)

The hackathon is HSK Chain Horizon, Track 1 (AI agents), with submission on DoraHacks.
- **Deadline (assumed): 1 Nov 2026, 21:30 IST.** Re-confirm on the DoraHacks page before relying on it.
- A testnet demo is acceptable. Mainnet is out of scope unless the owner explicitly authorises it later.

All times below are IST. "Owner" means Nishanth: he runs anything that needs a private key, a Ledger or a broadcast. Codex runs code and tests only.

## Milestones

| # | Milestone | Who | Target (IST) | Acceptance criteria |
|---|---|---|---|---|
| M0 | Docs and agent rules | bot | 28 Oct | AGENTS.md, PLAN, ADDRESSES and CODEX_ENV are on `main`, and `data/research/` holds the fixtures |
| M1 | Scaffold, Foundry and fork harness | Codex T1 | 28 Oct | See M1 below |
| M2 | Contracts and tests | Codex T2 | 29 Oct, 14:00 | See M2 below |
| M3 | Testnet deploy script | Codex T3, then the owner runs it | 29 Oct, 20:00 | See M3 below |
| **G** | **GO / NO-GO** | owner | **29 Oct, 23:59** | See the decision rule below |
| M4 | Evidence module, decision engine and backtest replay | Codex T4 | 30 Oct, 14:00 | See M4 below |
| M5 | Keeper loop | Codex T5 | 30 Oct, 22:00 | See M5 below |
| M6 | Verifier CLI | Codex T6 | 31 Oct, 12:00 | See M6 below |
| M7 | Dashboard | Codex T7 | 31 Oct, 22:00 | See M7 below |
| M8 | Demo script and DoraHacks README | Codex T8, then the owner | 1 Nov, 16:00 | See M8 below |
| — | Buffer, video and submission | owner | 1 Nov, 16:00–21:00 | The owner submits; the bot never submits |

## Acceptance criteria by milestone

**M1: scaffold, Foundry and fork harness**
- `forge build` and `pnpm -r build` both succeed.
- A fork smoke test on 177 reads the primary pool's `slot0` and the QuoterV2 quote. It skips if there is no RPC.
- CI-style `pnpm test` is green.

**M2: contracts and tests**
- ReceiptChain, EdgewiseVault and ProofTradeRouter all pass unit tests.
- Mainnet-fork tests run a real swap through SwapRouter02 at a pinned block.
- Every rule in AGENTS.md §2/§3 has a test, including the negative tests: wrong caller, expired mandate, over cap, slippage over 100 bps, a stale deadline, a nonce replay, a broken prevHead, and the allowance being 0 after a trade.
- `forge coverage` on `src/` is ≥ 90% of lines.

**M3: testnet deploy script**
- `Deploy.s.sol` dry-runs on an anvil fork of 133.
- It refuses any chain other than 133/31337, and refuses when the owner, deployer and agent addresses are not distinct.
- The owner broadcasts it locally on 133, and `docs/ADDRESSES.md` gets the deployment row.

**M4: evidence module, decision engine and backtest replay**
- `decide()` is pure and has 100% branch coverage across the TRADE/RESIZE/WAIT/REJECT paths.
- The evidence pack's canonical hash is stable (golden test).
- **Reference parity:** a TS port of `data/research/backtest_reference.py` reproduces `backtest.json` exactly for all three strategies (in-sample and out-of-sample, both marks, to 2 dp).
- An engine-mode replay over `market_history.json` prints a report with no look-ahead.

**M5: keeper loop**
- `keeper run --once --exec anvil` performs evidence → decide → receipt JSON → tx on a local anvil fork of 177, and leaves a Receipt event whose hash matches the JSON.
- `--exec testnet` refuses to start without the env keys, and refuses to start if the chainId is not 133.
- WAIT and REJECT produce `commitHold`.

**M6: verifier CLI**
- `verify <tx>` re-hashes the evidence, replays `decide()`, matches the receipt hash and the chain link, and prints slippage versus quote, fee, gas and P&L.
- A tampered evidence byte makes it FAIL.

**M7: dashboard**
- The dashboard runs with `pnpm dev`.
- It has four views: mandate, live evidence, decisions and receipts, and verify.
- The owner panel builds `setMandate`/`revoke` calldata and signs it via a Ledger (WebHID), with a "blind signing" warning. A mock signer is used in tests.

**M8: demo script and DoraHacks README**
- `scripts/demo.sh` and `DEMO.md` walk through the 8-step script below.
- The README has the architecture, the honest limits and the addresses.
- A DoraHacks text draft is in `docs/DORAHACKS.md`. It is not submitted.

## Go / no-go: end of day, 29 Oct 2026 (23:59 IST)

**GO (full Edgewise × ProofTrade)** only if **both** of these hold:
1. **The Ledger signs on chain 133.** The owner's Ledger, via the dashboard or the M3 helper, successfully signs and broadcasts `setMandate` to the deployed EdgewiseVault on testnet 133. Blind signing is acceptable and is expected.
2. **A testnet vault trade succeeds.** The keeper's agent key calls `trade()` on 133, the swap fills on the HSKSwap testnet pool, and the Receipt event is emitted with `amountOut >= minOut` and the allowance back at 0.

**NO-GO, so ship ProofTrade only:**
- Drop EdgewiseVault and the Ledger UI from the demo (leave the code, unadvertised).
- The keeper uses `ProofTradeRouter.commitAndSwap` and `commitHold` from its own testnet wallet.
- M4–M8 stay the same, and the dashboard hides the owner panel.

Record the decision and evidence (tx hashes) in this file under "Decision log".

## Demo script (target, about 3 minutes)

1. **Ledger signs `setMandate`** on 133. Show the blind-signing screen honestly.
2. **Live monitor** of mainnet (read-only): the basis versus CEX, the QuoterV2 cost curve, DEX staleness and APRO age.
3. **WAIT:** the edge is below the cost, so a `commitHold` receipt is written with its evidence.
4. **TRADE** on testnet. It is labelled "testnet: prices not real" and the receipt is on-chain.
5. **An oversized request** is shown as RESIZED, and one that breaks a cap is REJECTED.
6. **The receipt P&L** is shown in the verifier (slippage, fee, gas).
7. **A natural-language request**, "be more conservative", becomes a parameter diff. An attempt to widen beyond the mandate is refused, because it would need a new Ledger signature.
8. **Ledger `revoke`.** The next `trade` reverts, and the revert is shown.

## Risks and mitigations

- **The Ledger flow is untested on 133** (the main risk, which is why the go/no-go exists).
  - The LGA repo used `@ledgerhq/device-management-kit` with WebHID.
  - Blind signing must be enabled in the Ethereum app.
  - Chain 133 may not be recognised by the app. This is **UNVERIFIED**.
- **The testnet faucet** (faucet.hsk.xyz, which redirects to faucet.hashkeychain.net) has not been tried. Claim test HSK early, on 28–29 Oct.
- **APRO staleness:** the feed was 20.8 h old. Use it as a wide band only, and fail-closed REJECT is acceptable.
- **Thin mainnet liquidity and one dominant counterparty.** This is shadow mode only, and the copy makes no profit claims.
- **Codex Cloud cannot hold private keys**, because secrets are removed before the agent phase. All broadcasts happen locally.

## Decision log

- 28 Oct 2026: chose the merged Edgewise × ProofTrade project (owner).
