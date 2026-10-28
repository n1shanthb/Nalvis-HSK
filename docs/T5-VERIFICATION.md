# T5 verification

Base: latest main `aa395ae38dee9d01a17d13b12f1b837e29d09a36` (T4 merged).
The initial checkout was T2; main was recovered via GitHub integration after the
configured proxy refused git fetch. Its complete reconstructed tree matched
`20796eedca281844e903e8fbd1a98826353f09ff`; the feature worktree is based directly
on the original T4 commit.

Local results (28 Oct 2026, IST):

- `pnpm test`: PASS. Direct Vitest report: 108 passed, 2 skipped, 12 files.
- `pnpm -r build`: PASS (all packages and dashboard).
- `tsc --noEmit -p tsconfig.json`: PASS.
- ESLint on keeper sources/tests and typed ABI exports: PASS.
- `bash scripts/check-rules.sh`: PASS.
- `keeper run --once --exec dry`: PASS, offline, writes JSON and prints WAIT.
- Offline DEMO scenarios: TRADE, RESIZE, WAIT and REJECT, each with a committed
  sample JSON under `receipts/demo/31337/`. No transactions were submitted.
- Wallet-client source review: one production keeper construction, after the
  RPC-reported 133/31337 guard. Mainnet has only a public client. Test wallets
  are all bound to a local 31337 chain.
- `forge test`: unavailable locally (`forge: command not found`). GitHub branch
  CI must pass its Foundry checks before the PR is opened.

The cached environment supplies pnpm 11 instead of the repository's pnpm 9 pin.
The local run used `XDG_DATA_HOME=/workspace/work/data`,
`XDG_CACHE_HOME=/workspace/work/cache`, `pnpm_config_pm_on_fail=ignore` and
`pnpm_config_verify_deps_before_run=false`, using cached dependencies without
network/package-manager downloads. No repository package-manager pin was changed.

Sample **actual dry-run** log:

```text
28/10/26, 17:31:44 IST DEMO — synthetic scenario; no proven edge — dry WAIT receipt=0xf925bc8b8690e441f159044d5044d3e8d07bf2bf7098bbfff2934408361459ce
28/10/26, 17:31:45 IST DEMO — synthetic scenario; no proven edge — dry TRADE receipt=0xb82d82cc03fa2e4b06d73281fd8155464ef2a250fbf9a3caa0ee1ce4c3898f19
28/10/26, 17:31:45 IST DEMO — synthetic scenario; no proven edge — dry RESIZE receipt=0xccbf1e23e1a1568ee2feec8086705fe7252d50f38c411deb5a9a00c982c2d884
28/10/26, 17:31:45 IST DEMO — synthetic scenario; no proven edge — dry REJECT receipt=0x4ad6ac5f8db3a298f044a2a8f4d67227a6da2bc77a31da3d53db1919aaa35df8
```

Actual **Anvil integration invocation** result:

```text
SKIP keeper anvil fork integration: anvil binary unavailable
packages/keeper/test/anvil.integration.test.ts (1 test | 1 skipped)
```

This is a skip log, not a successful anvil-run log. No fork tx hash, mined
settlement, or successful swap is claimed. The other skip is T4's opt-in live
evidence test. No broadcast was made to 133 or 177.

UNVERIFIED locally: fork deployment/swaps, real QuoterV2/TWAP integration,
revocation integration, router execution/approvals, artifact ABI regeneration,
testnet human operation and all real service availability. Router loss accounting
includes swap/hold gas but does not reconstruct approval/reset gas. The daily
stop tracks conservative execution losses, not inventory mark-to-market P&L.
All network-dependent claims remain explicitly limited to the CI/test evidence.
