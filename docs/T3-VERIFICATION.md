# T3 verification

Base: latest main `eee9478fe78efdaa605a0517a8e119821fed1325` (merged T2 / PR #2),
confirmed with GitHub before implementation. Verified 28 October 2026.
Foundry 1.8.6, native solc 0.8.24, optimizer 200. The pinned forge-std submodule
is unchanged. No testnet/mainnet broadcast and no real keys were used.

- `forge test -vvv`: **107 passed, 0 failed, 1 skipped**, 108 total.
  The new testnet deployment + real USDT/WHSK pool swap passed at fork blocks
  34997560 / 34997562, including a real WHSK sell built by TradeCalldata.
  Receipt payload/head, owners, oracle zero and allowance reset verified.
  The one skip is the existing real-APRO freshness test: ordinary contract calls
  to that feed revert. Mock oracle coverage continues offline.
- With `HSK_TESTNET_RPC=''`, the new real testnet test explicitly reports
  `SKIP: HSK_TESTNET_RPC missing`. It does not fabricate a swap result.
- Regression tests cover strictly reducing exposure while remaining above the
  cap, increasing exposure within the cap, and increasing exposure above it
  reverting atomically. Router nonzero price limits revert before token pulls;
  the existing zero-limit swap test confirms no tokens/allowances are left.
- Mandate helper tests verify exact default 18-decimal calldata, revoke, role
  collision, unsupported chain and unexpected token decimals.
- `pnpm test`: 7 tests across four packages pass. `pnpm -r build`, `pnpm lint`,
  `bash scripts/check-rules.sh` and `git diff --check` pass.
- `forge build --sizes`: vault runtime 11,759 bytes, router 3,043 bytes.
  No new production addresses or dependency changes.

The executor needed explicit network access and a local solc download; Forge
commands used `--use /workspace/Nalvis-HSK/work/solc`. Workspace pnpm commands
used writable PNPM_HOME/XDG_DATA_HOME under ignored work/ plus
`--config.manage-package-manager-versions=false --config.verify-deps-before-run=false`.
These are executor accommodations, not repository configuration changes.

## Local Anvil deployment acceptance

Started `anvil --fork-url "$HSK_TESTNET_RPC" --chain-id 31337 --silent`.
Used only Anvil's publicly known dev wallet #0, derived at runtime, and public
addresses #1/#2 for owner/agent. Set DEPLOY_COMMIT to `git rev-parse HEAD`.

```text
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
  --broadcast --private-key "$ANVIL_DEV_KEY" -vvv
Chain 31337
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
Transactions saved to: .../broadcast/Deploy.s.sol/31337/run-latest.json
```

`deployments/31337.json` was written with exactly vault, router, owner, agent,
deployer, block and commit. Both deployed `owner()` reads matched wallet #1,
manifest roles were distinct and deployer matched wallet #0. Generated local
manifests, broadcasts, caches, raw logs and development wallet handling remain
ignored. The manifest `block` is the simulation block, not a mined receipt block.

A second Anvil on port 8546 forked mainnet block 29413000 with chain ID 177.
No signing/broadcast flags were supplied to its Forge invocation:

```text
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546
Deploy::run()
  [Revert] Deploy: only chains 133/31337
Error: script failed: Deploy: only chains 133/31337
```

## Human commands and remaining UNVERIFIED items

The full ordered commands, funding, quote/minOut, deployment, calldata extraction,
Ledger signature, agent trade and revoke are in
[scripts/testnet-bootstrap.md](../scripts/testnet-bootstrap.md).
The human deployment command is:

```bash
export DEPLOY_COMMIT=$(git rev-parse HEAD)
export TWAP_WINDOW_SEC=600
cd contracts
forge script script/Deploy.s.sol --rpc-url "$HSK_TESTNET_RPC" --broadcast \
  --private-key "$TESTNET_DEPLOYER_KEY" -vvv
```

Only the human runs that command against 133. Faucet claiming, live testnet
fund acquisition, Ledger blind signing / `cast send --ledger` on 133 and live
vault deployment/trading are still **UNVERIFIED**. Fork success does not establish
the GO decision in PLAN.md. Testnet prices are fake; there is no proven edge.
The owner must verify the mined deployments and update ADDRESSES.md, then record
GO/NO-GO with transaction evidence by 29 October 2026, 23:59 IST.

Policy files must be canonical JSON under the repository convention. The helper
hashes exact default.json bytes; the currently absent file warns and yields zero.
The first-trade helper uses the default mandate's 1% TWAP floor and fails closed
if stale calldata, tighter mandates or the live pool prevent execution.
