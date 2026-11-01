# Human bootstrap: chain 133 execution, chain 177 read-only evidence

Nishanth runs these steps locally after all task PRs merge. Codex never receives
keys, deploys, or broadcasts to testnet/mainnet. Use Node 22, pnpm 9, Foundry,
Python 3, jq and a Ledger Ethereum app with **blind signing enabled**. Chain 133
has no clear-signing descriptor. Faucet claims and Ledger support on 133 remain
**UNVERIFIED** until the human records actual successful transactions.

**Honest framing:** prices/evidence are real mainnet data; execution is a testnet
sandbox pool with its own price (roughly 54 USDT/WHSK on 31 October, versus real
mainnet roughly 0.0875). Read the execution price at setup; never use the mainnet
price to size testnet caps or claim real P&L. There is **no proven edge**.

## 1. Local environment and funding

Create distinct owner (Ledger), deployer and agent roles. Keep keys only in
runtime environment variables. Do not put them in shell history, chat, git,
Docker build arguments or frontend variables. Disable shell tracing before any
secret input. Use secure local entry for `TESTNET_DEPLOYER_KEY` and
`AGENT_PRIVATE_KEY`; the agent has gas only. `TESTNET_AGENT_KEY` is the legacy
keeper variable, not the always-on service's signer variable.

Set public `OWNER_ADDRESS`, `DEPLOYER_ADDRESS`, `AGENT_ADDRESS`, and the documented
`HSK_TESTNET_RPC`/`HSK_MAINNET_RPC`. All token, pool, quoter and router addresses
come from the single config backed by [ADDRESSES](../docs/ADDRESSES.md).

Claim test HSK from https://faucet.hsk.xyz (redirects to
https://faucet.hashkeychain.net). Faucet remains **UNVERIFIED**. Before setup:

- Deployer: **at least 3 test HSK** for acquisition, wrapping and deployment gas.
- Agent: **at least 0.5 test HSK** for execution gas.
- Ledger owner: sufficient test HSK for mandate/Pause/revoke gas.

Stop if short; scripts do not invent funding or bypass the faucet. Top the deployer
back to the preflight threshold after setup if needed. No real funds.

```sh
pnpm install --frozen-lockfile
pnpm --filter @nalvis/keeper build
# Set both models before generating the policy:
export STRATEGIST_MODEL=anthropic/claude-haiku-5.5
export FITTER_MODEL=xiaomi/mimo-v2.6-flash
scripts/testnet-setup.sh --dry-run
```

Dry run reads chain 133, pool `slot0` and token0/decimals, computes the WHSK input
and prints every mandate raw value beside a human summary. It does not deploy,
sign or write a policy. For a local fork/mock dry-run the endpoint must still
report 133; the script refuses any other chain, including 177.

## 2. Deploy, acquire tokens, fund, generate policy and build calldata

Run locally, once the plan and role addresses have been reviewed:

```sh
scripts/testnet-setup.sh --execute
```

This script asserts chain 133 before every write and prints each mined transaction
hash. It deploys only if `contracts/deployments/133.json` is absent. If a manifest
exists, it validates code and owner rather than redeploying. After a failed deploy,
inspect successful receipts before removing a stale simulation manifest. The
manifest records the simulation block: verify both actual deployment receipts in
`contracts/broadcast/Deploy.s.sol/133/run-latest.json`, code, owners and constructors.

Acquisition reads the **execution pool** price and current balances, computes
WHSK needed to reach **at least 60 test USDT**, and wraps that plus the WHSK vault
top-up. It adds a 3% planning buffer, then requires a fresh QuoterV2 quote whose
99% minOut still covers the target. If not, STOP/replan; do not lower minOut.
It uses exact approvals and resets approval after swap (including a best-effort
reset on failure). The router tuple has no deadline; `multicall` supplies one.
No fixed 0.5 HSK acquisition amount is used.

The vault receives only missing amounts to reach **50 test USDT and 0.5 WHSK**.
The old 5 USDT/0.1 WHSK funding could not cover the smallest trade. Token decimals
are read; 133 USDT has 18 decimals while 177 USDT has 6.

The script writes exact canonical sorted-key `policy/agent-v3.json` with
`strategyHash`, signed model/prompt definitions and execution-price-based mandate:

| Field | Default |
| --- | --- |
| `maxTradeInB` | 25 test USDT |
| `maxDailyInB` | 200 test USDT per rolling 24h |
| `maxTradeInA` | ceil in raw WHSK units of `1.2 × 25 / executionPrice` (about 0.56 at 54) |
| `maxSlippageBps` | 100 bps = 1% |
| `maxExposureBps` | 8000 bps = 80% |
| `maxDrawdownBps` | 2000 bps = 20% |
| `minIntervalSec` | 300 seconds |
| `expiry` | execution block timestamp + 7 days |

It prints the hash and invokes `MandateCalldata.s.sol`, which hashes those exact
v3 policy bytes and builds the matching mandate. Output is `work/mandate.json`
and `work/set-mandate-calldata.txt`. It **stops before Ledger signing**. Keep the
same policy bytes and model identifiers on the service. Regeneration changes
expiry/hash, requiring a new owner signature. No APRO exists on 133; deployment
uses zero on-chain oracle. Mainnet APRO remains evidence only.

## 3. Nishanth signs setMandate on the Ledger

Review destination, chain 133, agent, expiry, every cap and policy hash. The
read-only calldata builder never broadcasts. Use the dashboard wizard if it can
reproduce the exact generated fields/hash; otherwise use the reviewed calldata:

```sh
export VAULT_ADDRESS=$(jq -er '.vault' contracts/deployments/133.json)
SET_DATA=$(cat work/set-mandate-calldata.txt)
test "$(cast chain-id --rpc-url "$HSK_TESTNET_RPC")" = 133
cast send "$VAULT_ADDRESS" --data "$SET_DATA" --ledger --sender "$OWNER_ADDRESS" \
  --rpc-url "$HSK_TESTNET_RPC" --mnemonic-derivation-path "m/44'/60'/0'/0/0"
```

Never use the deployer or agent key for owner actions. Save the mandate tx hash.
Read back `mandate()` and confirm exact hash/caps. A stale expiry, policy mismatch,
paused/revoked mandate or wrong signer shows NEEDS_OWNER and prevents execution.

## 4. Register, start, confirm first wake/anchor and verify

Add verified vault **and** ProofTradeRouter rows to
[ADDRESSES](../docs/ADDRESSES.md) with chain, addresses, mined deployment tx hashes,
commit and constructor arguments. This is required before dashboard/service
address authorization; do not invent deployment rows. Record first-wake/anchor
transaction evidence alongside them after confirmation. Keep the verified 133
manifest and canonical policy in the reviewed deployment checkout.

Set server-only `OPENROUTER_API_KEY` and `AGENT_PRIVATE_KEY` via the host's env UI.
See [Railway kit](../deploy/agent/README.md) for the volume, variables and HTTPS
feed. For a local always-on process use persistent state, or explicitly opt into
local storage with `AGENT_ALLOW_EPHEMERAL=1`:

```sh
pnpm keeper agent --exec testnet
```

No key means OFFLINE and zero sends. `tick` polls watches; it wakes only on eligible
conditions, including heartbeat/owner events. Confirm `/feed/state`, active watches,
journal entries and the first wake/WAIT anchor or trade. Stop cleanly before freeze:

```sh
pnpm keeper export-agent --chain 133
pnpm verify receipts/133/agent/receipts/<receipt-hash>.json \
  --rpc "$HSK_TESTNET_RPC" --agent-root receipts/133/agent
scripts/agent-preflight.sh
```

Preflight needs `AGENT_FEED_URL` (HTTPS), public roles/vault, matching policy and
runtime env names. It checks balances, signer, hash and live mandate. Outputs
presence/check results only, never secrets. Review exported files before force
adding generated receipts to git at freeze. Without a reachable feed the dashboard
shows its fallback banner, exported snapshot and on-chain Receipt logs. An absent
export shows no invented history. v3 verification binds model outputs and artifacts;
**model outputs are recorded and bound, not reproduced**.

## Stop and recover

Railway stop/systemd stop sends SIGTERM; let the current wake/mining wait finish.
Owner Pause on the Ledger prevents execution immediately and is observed at the
next poll. Owner revoke removes authority. Unresolved `.pending.json`/`pending.json`
intents are reconciled with mined Receipt logs and wallet nonces, never resent
blindly. Inspect uncertain transactions manually. Retain the entire state root;
missing evidence/journal or truncated data fails verification closed.

GO requires an actual Ledger mandate and successful vault trade on 133 with a
matching Receipt, `amountOut >= minOut`, and zero router allowance. Record the
human-verified evidence in docs/PLAN.md. Anvil tests alone do not establish GO.
