# Dashboard live-state review (#23)

## Root causes

- Feed reads and exported-artifact paths previously followed the build environment rather than the selected route chain. An explicit selected chain now follows feed, snapshot and Verify reads. Unknown/wrong-chain and demo feeds are rejected outside explicit demo mode.
- Feed refresh failures previously cleared the last good live observation, or replaced it with an older export. The shared route provider now retains the last observation and exposes connection failure separately from provenance. Export refreshes cannot regress the observation timestamp.
- Mainnet owner submission currently invokes `reload()` immediately after broadcasting and supplies no hash. This can reread the pre-mine mandate. Dashboard reads now bypass the block-number cache, poll without unmounting review state, and support shared invalidation. Existing confirmed owner callbacks invalidate mounted reads; read-only decision transaction inspection distinguishes pending, mined and reverted receipts. Submission is never presented as confirmation by the new panels.
- Zero expiry was formatted as 1970/Expired. Unconfigured mandates now say **Not configured**. Shared presentation displays agent, expiry/countdown, exact human-unit limits and policy hash. Mainnet chart and operation labels no longer default to testnet.

## Dependencies requiring owner review

**Infrastructure:** the keeper's persistent disk is authoritative. Its `127.0.0.1:8787` listener is VM-local. The contributor has no approved public feed URL or exported mainnet snapshot. No host, ingress, OCI, Vercel environment, secrets or feed route was changed. The infrastructure owner must supply an approved browser-reachable read-only feed (including allowed origin/HTTPS as appropriate), or publish an approved export under the existing `/receipts/<chain>/agent/` interface. This PR does not claim to have inspected the deployed Vercel environment. Local missing `VITE_AGENT_FEED_URL` and missing exports were reproduced separately from configured-feed failure in tests.

**Mainnet owner callback:** `MainnetOwner.tsx` is intentionally untouched. For immediate post-confirmation refresh and owner transaction tracking, propose this separate owner-reviewed presentation callback contract:

```ts
onSubmitted({ chainId, transactionHash }): void;
onConfirmed({ chainId, transactionHash, blockNumber }): Promise<void>;
```

The read layer would observe submission using the public client and invalidate reads only after a successful receipt. Existing `reload()` cannot communicate the submitted hash or distinguish submission from confirmation. Until owner cooperation is approved, mainnet mandate changes reconcile on the next completed read poll (30 seconds after the previous poll finishes), or navigation reload. No signing/execution implementation is changed here.

**Feed data:** existing actions provide time, original intent, final verdict, explanation, rounds, violations and optional hashes. They do not provide transaction lifecycle/verification status, nor inline evidence time/block. The details panel reads the existing v3 receipt/evidence artifact endpoints on expansion and labels recorded validation/simulation separately from independent verification. Missing artifacts stay unavailable. No model thoughts, financial values or extra wire fields are generated. The two-minute stale-observation notice is a UI age threshold, not a declaration that the keeper is offline.

## Screenshots and browser checks

- [Live mainnet mandate](mainnet-mandate.png): actual read-only RPC and checked-in deployment configuration, captured 2 November 2026 IST. No fixture RPC responses. Owner actions disabled in the local review process.
- [Unavailable feed, desktop](unavailable-feed-desktop.png) and [mobile](unavailable-feed-mobile.png): actual missing local configuration and absent mainnet export. No replacement agent records.
- [WAIT details, desktop — FIXTURE](wait-details-FIXTURE-desktop.png) and [mobile — FIXTURE](wait-details-FIXTURE-mobile.png): visibly labelled UI fixture using the explanation/time from an existing recorded local Anvil WAIT. **Not a live mainnet WAIT.** An authentic live WAIT screenshot remains blocked on approved feed/export access; the user confirmed neither is available.

Headless Edge/Playwright checked 1440px desktop and 390px mobile, reduced-motion fallback, no horizontal overflow on Agent, and keyboard Enter opening the native decision details. No browser page errors were observed. RPC requests in browser review were guarded to allow only read methods. No Ledger connection or transaction submission was performed.

## Scope confirmation

All changes are under `apps/dashboard`. No Ledger/signing/derivation, mandate form/wizard or owner action execution files changed. No mandate contents/limits, keeper/core/verifier execution, OCI/network, Docker, contracts/ABIs/deployments, policies/hashes, receipt commitments, persistence or receipt-verification algorithms changed. Verify changes are selected-chain read-only client wiring and presentation only.

@n1shanthb: review the dashboard changes and the infrastructure/callback dependencies before merge. Do not merge until the required live-feed acceptance evidence is available.

## Validation

- `npm run build` in `apps/dashboard`: passes (TypeScript + Vite). Vite reports chunk-size and mixed static/dynamic import warnings; shared mandate presentation also produces a mixed-import warning. These are not build failures.
- `npm run lint` in `apps/dashboard`: passes.
- `npm test -- --maxWorkers=2` in `apps/dashboard`: 29 files / 185 tests, including 13 new live-state regressions. No unresolved dashboard test failures. The existing withdrawal guard test logs its expected error to stdout.
- `git diff --check`: passes. Final path audit confirms no changes outside `apps/dashboard` and no owner execution/signing files.

The installed machine-wide pnpm 11 initially blocked on its esbuild build-approval policy (the repository declares pnpm 9.15.9). npm ran the existing package scripts against the locked installed dependencies; no package/lock/workspace configuration changes are included. The first test attempt ran before production assets existed; rebuilding resolved that prerequisite. A new response-reuse test mock was corrected before the final run. No pre-existing test failures remain to report.
