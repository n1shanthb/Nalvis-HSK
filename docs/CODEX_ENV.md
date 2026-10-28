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

## 5. Secrets

**Set none in Codex.** The table below is a local-only `.env` on Nishanth's machine. It is gitignored, and the repo has a `.env.example` with empty values.

| Name | Where | Notes |
|---|---|---|
| `TESTNET_DEPLOYER_KEY` | local only | A fresh testnet-only key. It has no role after deploy. |
| `TESTNET_AGENT_KEY` | local only | A fresh testnet-only key, ≠ deployer. It holds no funds beyond gas. |
| `OWNER_ADDRESS` | local; may also be a Codex env var because it is public | The Ledger's address (derivation `44'/60'/0'/0/0` unless changed). It must differ from both keys. |
| `LLM_API_KEY` | local only, optional | Only for the optional explanation feature. The app works without it. |

**There is never a mainnet key anywhere.** No mainnet RPC write path exists.

## 6. One-time steps for Nishanth (outside Codex)

1. In Codex: sign in with ChatGPT, connect GitHub, and grant access to `n1shanthb/Nalvis-HSK`. Then create the environment with the settings above.
2. Generate two fresh testnet keys locally, e.g. `cast wallet new` twice. Fund them with test HSK from the faucet (https://faucet.hsk.xyz, which redirects to https://faucet.hashkeychain.net/; **UNVERIFIED** in use).
3. On the Ledger's Ethereum app, enable **Blind signing**. Chain 133 has no clear-signing metadata.
