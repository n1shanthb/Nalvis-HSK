# T8 implementation and verification

Base: merged Task 9 (`a75b29e`). Branch: `t8-desk-ui`. No Solidity changes, no
remote writes, and no mainnet signing or broadcasting. Never merge this PR automatically.

## Local preview

Run from repository root:

```powershell
$env:VITE_ENABLE_OWNER='false'
$env:VITE_DEMO_MODE='true'
pnpm --filter @nalvis/dashboard dev --host 127.0.0.1
```

Open http://localhost:5173/?demo=1. All five routes support the same clearly
labelled recorded local-Anvil session. Turn Demo mode off for live read-only
network evidence. Demo mode disables network selection and owner controls.
The chart uses actual captured observation points only. Legacy fixtures have no
risk/expiry fields and are labelled accordingly. The owner panel is not loaded
by the hosted read-only configuration.

## Validation

- Workspace tests: 225 passed, one opt-in live collector test skipped; including 36 desk intent/proposal tests, five risk/expiry
  tests, stale-before-send keeper coverage and two verifier expiry checks.
- Genuine local fork integration passed all four outcomes and revoke, and verified
  each newly generated receipt against the running local RPC. Mainnet was read-only.
- Solidity suite: 139 passed, 0 failed, 5 skipped (missing optional RPC settings).
- `scripts/check-rules.sh`: PASS through Git Bash (Windows python3 wrapper).
- Production build and lint/type checks run from the workspace. Route splitting
  and Ledger package chunks remove the previous >500 kB chunk warning.
- Browser check: five demo routes, working desk P&L reply, verifier PASS, no page
  errors; mobile viewport 390 x 844 had document width 390 (no horizontal overflow).
- Existing T6 recorded fixtures still verify without modifying any receipt/tx hash.
- Backtest fixture unchanged; no proven edge.

Local tool runtime: Node 24.22.1, pnpm 9.15.9, npm-distributed Foundry. CI uses
its existing pinned Node 22 and Foundry versions. Network-dependent tests report
explicit skips when endpoints/settings are absent.

## Screenshots

Before: ![Original mandate view](screenshots/t8-before-overview.png)

After: ![Recorded console overview](screenshots/t8-after-overview.png)

Desk: ![Desk P&L response](screenshots/t8-after-desk.png)

Mobile: ![Mobile overview](screenshots/t8-after-mobile.png)

## Hosted demo

Production: https://nalvis-hsk-demo.vercel.app

Deployed to `nevan-sonics-projects/nalvis-hsk-demo` after the user completed Vercel
login. An unauthenticated browser received HTTP 200, rendered the overview with
four verified decisions and answered the Desk P&L command without page errors.
The build explicitly disables owner actions and enables recorded demo mode.
No GitHub auto-deployment integration was added.

## External follow-up — UNVERIFIED

Organizer confirmation is outside code implementation. No Telegram message was
sent and no organizer answer/screenshot is claimed. Suggested question for the
project owner: “Can you confirm in writing whether a testnet-only deployment is
eligible for demo selection in Track 1? The DoraHacks page says mainnet is
required. Our live mainnet market reads are read-only; execution is on chain 133.”
No recurring team-chat messages were scheduled or sent.
