# Mainnet readiness — preparation only

Status: NOT READY TO BROADCAST. This PR does not enable chain 177 writes.
The existing write allowlist, deployment script and Ledger restrictions remain enforced.

Read-only validation on 1 November 2026: block 29595715 passed bytecode,
pair/decimals/fee/liquidity and 600-second observation checks. Forward quotes:
0.10 USDT -> 1.138287033364222586 WHSK; 0.50 -> 5.69142997023436551;
1.00 -> 11.382846949028550132. Independent reverse quotes returned 0.0994,
0.497003 and 0.994004 USDT respectively. These are historical observations,
not executable promises. Keeper TypeScript build and command syntax passed.
No deployment, swap, signature or provider request was made. Full execution/fork
acceptance remains outstanding; this is a draft preparation PR.
Do not use competitor contract addresses as Nalvis deployment destinations.

## Read-only market preflight

Build the keeper, set HSK_MAINNET_RPC privately to the documented RPC, then run:

```sh
pnpm --filter @nalvis/keeper build
node packages/keeper/mainnet-readiness.mjs
```

The probe pins reads to one block, verifies configured bytecode, WHSK/USDT token
identity, 18/6 decimals, fee and nonzero liquidity, tests the existing 600-second
TWAP window and obtains independent forward/reverse quotes at tiny USDT sizes.
It cannot sign or send. Quotes expire immediately with changing pool state.
Reverse quotes are not a sequential swap simulation and are not profit estimates.

## Required execution-enablement work

- Add a dedicated human-run mainnet deployment path, never reuse testnet addresses.
  Verify router/pool/token configuration and distinct owner/deployer/agent roles.
  Record mined deployment receipts, bytecode, constructor arguments and commit.
- Extend chain 177 support coherently through evidence, receipts (including v3),
  verifier, keeper, deployment manifest, owner Ledger review and dashboard. Merely
  extending CHAIN_ALLOWLIST_WRITE is insufficient. Preserve 133/31337 negative tests.
- Separate real execution labels from sandbox labels. Use USDT 6 decimals in caps,
  sizing, quotes, funding, receipts and UI. Never reuse testnet policy raw amounts.
- Rehearse exact production vault deployment, signed-policy calldata, swap/hold,
  receipt verification, pause, revoke, withdraw and crash recovery on local 31337
  fork with real 177 router/pool. No remote writes in automated tests.
- Check allowance returns to zero and full input consumption, measured quote/TWAP
  floors, exposure, rolling turnover and drawdown under tiny balances and rounding.
- APRO normal contract calls previously reverted. Do not claim oracle protection
  without a successful current contract-context test. An oracle-zero deployment
  uses pool TWAP only and requires explicit review of that risk.
- Resolve the top-level deterministic-engine mandate versus the newer autonomous
  strategist specification before authorizing either to spend real funds. Bind
  the exact selected strategy/models/prompts and caps to the owner-signed policy.
- Obtain explicit human approval of the enablement PR and the exact deployment
  transaction/constructor review before any real funds or broadcast.

## Tiny pilot and gas

A 2–3 USDT total funding ceiling is a proposed pilot budget, not a validated
minimum or a trade-size setting. Require a fresh quote and fork simulation at
the actual size. Fund native HSK separately using measured deployment/transaction
gas and current fee estimates. No fixed gas price or fiat conversion is promised.
Do not force a trade merely to demonstrate activity when the engine says WAIT.
After an approved first tiny swap, verify receipt and balances, pause, withdraw
and inspect the complete result before any continuous operation.

## AI configuration

Create a dedicated OpenRouter key and enter it directly in the agent host's secret
settings as AGENT_OPENROUTER_API_KEY. Never paste credentials into chat, commit
them, put them in build arguments or use VITE_ names. AGENT_PRIVATE_KEY is a
separate restricted agent wallet secret; the Ledger owner key never leaves hardware.
Select actual account-supported STRATEGIST_MODEL and FITTER_MODEL identifiers,
generate the canonical policy with those exact choices and obtain owner approval.
Changing authorized models/prompts requires a new policy signature.
The current setup generator and Railway command are testnet-only; do not use
testnet-setup.sh or change --exec testnet to 177 as a mainnet workaround.

Current agent settings: AGENT_DAILY_LLM_BUDGET_USD=1.00,
AGENT_MAX_WAKES_PER_HOUR=12, AGENT_POLL_SEC=30; these bound provider activity,
not trading losses. Persistent storage, single writer, HTTPS feed and exact CORS
origin are still required. Configure VITE_AGENT_FEED_URL only with the public feed
URL. Desk credentials are separate. Hosted provider availability remains UNVERIFIED.
