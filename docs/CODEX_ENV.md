# Codex Cloud environment: Nalvis-HSK

These are the settings to enter in Codex (chatgpt.com/codex): Environments, then **n1shanthb/Nalvis-HSK**.

Codex Cloud facts this setup relies on (OpenAI docs, read 28 Oct 2026):
- Setup scripts run with internet access. During the agent phase, internet access is **off by default** and can be limited to an allowlist.
- Setup scripts run in a separate shell, so put PATH changes in `~/.bashrc`.
- **Legacy "secrets" are removed before the agent phase.** In the newer UI, "network secrets" are proxy-substituted for HTTPS domains only, and environment variables are visible raw to the agent.

**Consequence: never give Codex a private key**, in any form. Codex writes and tests code on anvil and forks. Nishanth broadcasts to testnet 133 from his own machine.

## 1. Setup script (paste into "Setup script" / "Install script")

```bash
set -euxo pipefail
# --- Foundry (forge/anvil/cast) ---
curl -L https://foundry.paradigm.xyz | bash
export PATH="$HOME/.foundry/bin:$PATH"
foundryup            # installs latest stable
echo 'export PATH="$HOME/.foundry/bin:$PATH"' >> ~/.bashrc
forge --version
# --- Node 22 + pnpm (universal image ships Node; pin 22 in "Set package versions") ---
corepack enable
corepack prepare pnpm@9 --activate
pnpm --version
# --- Repo deps (tolerate an empty repo before Task 1) ---
if [ -f pnpm-lock.yaml ] || [ -f package.json ]; then pnpm install --frozen-lockfile || pnpm install; fi
git submodule update --init --recursive || true
if [ -f contracts/foundry.toml ]; then (cd contracts && forge build); fi
```

**Maintenance script** (runs when a cached container resumes):

```bash
export PATH="$HOME/.foundry/bin:$PATH"
git submodule update --init --recursive || true
if [ -f package.json ]; then pnpm install; fi
if [ -f contracts/foundry.toml ]; then (cd contracts && forge build); fi
```

Notes:
- Pin the forge-std version in Task 1, either as a git submodule under `contracts/lib/` or as a release tag. Running `forge build` in setup pre-downloads solc 0.8.24, so the agent phase doesn't need to.
- Whether forge and anvil honour the Codex HTTPS proxy when forking is **UNVERIFIED**. If fork tests can't reach the RPC, they must skip with a message (see AGENTS.md §4).

## 2. Package versions

- Node.js: **22**
- Python: default (only used to run `data/research/backtest_reference.py` for cross-checking; optional)

## 3. Agent internet access

Choose **On**, restricted to the **Common dependencies / Package managers** preset **plus** these additional domains:

| Domain | Why |
|---|---|
| `mainnet.hsk.xyz` | Read-only mainnet RPC for fork tests and evidence (chain 177) |
| `testnet.hsk.xyz` | Testnet RPC for fork tests (chain 133) |
| `graphnode.hashkeychain.net` | HSKSwap subgraph (last-swap timestamp) |
| `api.mexc.com` | CEX reference ticker (public) |
| `api.gateio.ws` | CEX reference ticker (public) |
| `hsk.blockscout.com` | Mainnet explorer API (optional) |
| `testnet-explorer.hskchain.net` | Testnet explorer API (optional) |
| `foundry.paradigm.xyz`, `raw.githubusercontent.com`, `github.com`, `objects.githubusercontent.com`, `binaries.soliditylang.org` | Foundry, forge-std and solc (setup; also allowed in agent phase for `forge install`) |
| `registry.npmjs.org` | pnpm (included in preset) |

**Allowed HTTP methods: ALL.** Do *not* restrict to GET/HEAD/OPTIONS, because JSON-RPC and GraphQL use **POST**.

Do **not** add `api.openai.com` or any LLM endpoint. Tests must never call an LLM.

## 4. Environment variables (non-secret; visible to the agent)

| Name | Value |
|---|---|
| `HSK_MAINNET_RPC` | `https://mainnet.hsk.xyz` |
| `HSK_TESTNET_RPC` | `https://testnet.hsk.xyz` |
| `FORK_BLOCK_177` | `29413000`. A recent mainnet block on 28 Oct 2026. Historical `eth_call` worked back to block 25,000,000, so the public RPC serves historical state. |
| `FORK_BLOCK_133` | leave unset (latest) until Task 3 pins one |
| `CHAIN_ALLOWLIST` | `133,31337` |

## 5. Local signing

**Set no wallet secrets in Codex or `.env`.** Import the already-approved
deployer and agent accounts into encrypted Foundry keystores using interactive
local prompts. The aliases are `nalvis-deployer` and `nalvis-agent`. Verify each
account's public address against `DEPLOYER_ADDRESS` and `AGENT_ADDRESS` from
the local `.env`; do not generate replacements or change the configured roles.
Keystore passwords are entered only at Foundry's local prompt.

`OWNER_ADDRESS` is currently the temporary deployment address
`0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927`; Nishanth's Ledger is the intended
final owner and its address must be supplied and verified later. Both contracts
support two-step ownership transfer: the current owner calls
`transferOwnership(ledgerAddress)`, then the Ledger calls `acceptOwnership()`.
Perform these as separate transactions for each contract and verify both
`owner()` values before using owner-only actions. Before handover, the temporary
owner must have a locally available encrypted Foundry signer matching
`OWNER_ADDRESS` so it can nominate the Ledger; the Ledger signing path on chain
133 requires local verification.
`LLM_API_KEY`, if used, is optional and local; the application works without it.

**There is never a mainnet key anywhere.** No mainnet RPC write path exists.

## 6. One-time steps for Nishanth (outside Codex)

1. In Codex: sign in with ChatGPT, connect GitHub, and grant access to `n1shanthb/Nalvis-HSK`. Then create the environment with the settings above.
2. Import only the existing approved deployer and agent accounts into encrypted Foundry keystores using local interactive prompts. Fund them with test HSK only through a verified faucet route (https://faucet.hsk.xyz redirects to https://faucet.hashkeychain.net/; **UNVERIFIED** in use). Do not generate replacement wallets.
3. On the Ledger's Ethereum app, enable **Blind signing**. Chain 133 has no clear-signing metadata.
