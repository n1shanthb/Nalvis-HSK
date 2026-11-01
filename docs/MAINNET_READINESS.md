# Mainnet pilot runbook

PR #17 implements opt-in mainnet execution. Default legacy keeper commands still
refuse mainnet writes. Human approval of this PR and review of actual deployment
and mandate transactions are required before broadcasting. No remote transaction,
real-funds transfer, real Ledger signature or model request was made by Codex.

## Implemented and tested

- Dedicated DeployMainnet.s.sol: chain 177 only, explicit acknowledgment, distinct
  roles, registry addresses, 18/6 decimals, 600-second TWAP and zero oracle. APRO
  normal contract calls revert; no APRO protection is claimed. Testnet deploy unchanged.
- Explicit agent --exec mainnet, acknowledgment, vault and reviewed deployment commit.
  Checks run before signer derivation, signing and broadcast. Pending sends are never
  automatically resent. Generic write allowlist remains testnet/local only.
- Mainnet state, evidence, v3 receipts and independent verification; real-funds labels.
- Mainnet-bound model prompts/policy hashes; existing sandbox hashes remain compatible.
- Ledger review of exact calldata, full arguments, destination, chain and calldata hash
  with explicit acknowledgment. Mainnet excludes the testnet preset wizard. EIP-155
  signature, selected chain and recovered owner are checked before broadcast.

Read-only block 29595715 passed bytecode, pair/decimals/fee/liquidity and 600-second
observation checks. Tiny 0.10/0.50/1 USDT quotes were nonzero; they are historical
observations, not executable promises. Run fresh read-only checks:

```sh
pnpm --filter @nalvis/keeper build
node packages/keeper/mainnet-readiness.mjs
```

Set HSK_MAINNET_RPC to the registry RPC. No wallet is constructed by the probe.
Reverse quotes are independent calls, not sequential swap simulation.

Pinned fork rehearsal passed exact deployment entry point, 2 USDT test-funded vault,
0.10 USDT real-router swap, zero allowance, receipt sequence/head, WAIT, pause/unpause,
revoke rejection and full withdrawal. This ran only in a local EVM.
Local Anvil chain identities 31337 and 177 passed v3 fitted trade/anchor verification
and tamper rejection with mocked AI/tokens. The separate fork covers real USDT decimals.
Windows file-store path/fsync compatibility is fixed for local tests; durable hosted
execution still requires Linux persistent storage and flock. Linux directory fsync
remains enabled. See PR checks for full suite results.

Local validation: 143 Foundry tests passed / 6 RPC-dependent skipped; the dedicated
pinned mainnet fork passed separately without a skip. Core 186 passed / 1 skipped,
including 240 seeded local contract-parity cases; verifier 63 passed, including both
v3 chain identities. Dashboard 171 passed, including default mainnet rejection and
opt-in chain-177 EIP-155 owner serialization. Keeper platform-independent regressions
20 passed; policy/activation tests 3 passed (activation included in the 20).
Full Linux service/flock/shell tests require CI; Windows has no working Linux daemon.

Market evidence and vault valuation follow the selected execution chain. A mainnet
dashboard rejects live feeds/snapshots without executionChainId=177, preventing a
misconfigured testnet feed from being presented as mainnet activity.

## Human deployment after approval

1. Select OWNER_ADDRESS (Ledger), AGENT_ADDRESS and a separate CLI-selected deployer.
   Never share keys with Codex. Set DEPLOY_COMMIT to the reviewed full commit SHA.
   Fund native HSK for gas separately from the proposed 2–3 USDT pilot inventory.
2. Set MAINNET_EXECUTION_ACK=I_ACCEPT_REAL_FUNDS_RISK_ON_177 only after approving
   real-funds deployment. First simulate without --broadcast:

```sh
cd contracts
forge script script/DeployMainnet.s.sol --rpc-url "$HSK_MAINNET_RPC" --sender "$DEPLOYER_ADDRESS" -vvvv
```

3. Review constructor values, gas estimates and every call. Only the human selects
   their local signer and adds --broadcast. No keys belong in chat or command output.
4. Verify BOTH mined deployment receipts, bytecode, owners, router/pool/tokens, decimals,
   TWAP window and zero oracle. 177.simulation.json is not a trusted live manifest.
   Publish reviewed contracts/deployments/177.json with the actual mined deployment
   block, vault/router/owner/agent/deployer and commit. Add both addresses, tx hashes,
   constructor arguments and bytecode/source verification to docs/ADDRESSES.md.
5. Fund only approved tiny inventory by exact token transfer. WHSK/USDT only, no USDC.
   Native HSK pays wallet gas. Never reuse raw testnet token amounts or disable floors.

## AI and signed policy

Enter AGENT_OPENROUTER_API_KEY directly in the host secret UI, separate from the
Desk key. AGENT_PRIVATE_KEY is the distinct agent gas wallet; never the Ledger
owner/deployer. No secret belongs in Git, build arguments, logs or VITE_ variables.
Select actual account-supported STRATEGIST_MODEL and FITTER_MODEL identifiers.
Provider/model availability remains UNVERIFIED until configured by the human.

Set those model names, AGENT_ADDRESS and HSK_MAINNET_RPC, then from repository root:

```sh
node packages/keeper/mainnet-policy.mjs
```

The generator writes NEW canonical policy/agent-mainnet-v3.json and prints unsigned
setMandate calldata. It refuses overwriting existing policy bytes. Pilot defaults:
0.10 USDT per buy, quoted equivalent WHSK sell cap, 0.50 USDT rolling daily turnover,
80% exposure, 1% slippage, 10% drawdown, 300-second cooldown and 24-hour expiry.
Review exact raw units and policy hash. Changing limits/models/prompts needs a new
owner signature. Commit only reviewed PUBLIC policy bytes with explicit git add -f
so the image contains /app/policy/agent-mainnet-v3.json. Never commit credentials.

## Ledger and hosted execution

Set VITE_EXECUTION_CHAIN=177 and VITE_MAINNET_EXECUTION=true only in the reviewed
owner-enabled dashboard build. Publish verified manifest/registry and rebuild.
Open Mandate, paste generated calldata, inspect all fields/hash, acknowledge real
funds and sign on Ledger. Blind signing applies; reject if adequate inspection is
unavailable. Pause/unpause/revoke use the same review; withdrawal takes exact ABI
withdraw(token,amount,to) calldata, including full recipient inspection.

Use the existing Docker image, one replica and persistent /data volume. Override
Railway's default testnet start command explicitly:

```sh
node packages/keeper/dist/keeper/src/cli.js agent --exec mainnet
```

Runtime variables:

```dotenv
AGENT_OPENROUTER_API_KEY=<secret entered in host UI>
AGENT_PRIVATE_KEY=<separate agent secret entered in host UI>
STRATEGIST_MODEL=<signed model ID>
FITTER_MODEL=<signed model ID>
HSK_MAINNET_RPC=https://mainnet.hsk.xyz
VAULT_ADDRESS=<verified Nalvis vault>
MAINNET_DEPLOY_COMMIT=<manifest commit SHA>
MAINNET_EXECUTION_ACK=I_ACCEPT_REAL_FUNDS_RISK_ON_177
AGENT_POLICY_FILE=/app/policy/agent-mainnet-v3.json
AGENT_DEPLOYMENT=/app/contracts/deployments/177.json
AGENT_DATA_DIR=/data
AGENT_MODE=agent
AGENT_POLL_SEC=30
AGENT_DAILY_LLM_BUDGET_USD=1.00
AGENT_MAX_WAKES_PER_HOUR=12
AGENT_FEED_CORS_ORIGIN=https://<dashboard-origin>
```

CI=true and NODE_ENV=test refuse activation. Never enable AGENT_ALLOW_EPHEMERAL
on a hosted mainnet service. Vercel receives public VITE_AGENT_FEED_URL pointing
to the HTTPS agent domain; no feed endpoint accepts transaction writes.

Confirm on-chain mandate/policy and /feed/state before a first wake. WAIT is valid;
never force a trade for a demo. Verify the first receipt, balances, allowance and
fees, then pause and withdraw before approving continuous activity. Stop before export:

```sh
pnpm keeper export-agent --chain 177
pnpm verify receipts/177/agent/receipts/<receipt-hash>.json --rpc "$HSK_MAINNET_RPC" --agent-root receipts/177/agent
```

Publish reviewed public snapshots only. Preserve journals/pending guards; never delete
guards to force retries. Ledger pause/revoke is the emergency authority. Live hardware,
hosting, model availability, deployment gas and public execution remain UNVERIFIED.
No proven edge. Tiny amounts limit exposure but do not establish security.
