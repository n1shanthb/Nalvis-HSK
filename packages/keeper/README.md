# Keeper

Run from the repository root, with Node 22 and pnpm 9:

```sh
pnpm install --frozen-lockfile
pnpm --filter @nalvis/keeper build
pnpm keeper run --once --exec dry
pnpm keeper run --once --exec dry --demo trade
pnpm keeper run --once --exec dry --demo resize
pnpm keeper run --once --exec dry --demo reject
```

Dry mode is entirely offline. It uses the labelled synthetic T4 fixture and a
zero-address contract sentinel (not a deployment), writes unsigned receipt
intents under `receipts/31337/`, and never constructs a wallet or sends a tx.
The default dry scenario is WAIT. The default policy is unchanged. DEMO is a
recorded synthetic scenario, **no proven edge**; labels are committed inside the
evidence and explanation. Dry trade calldata is `0x`, because no contract exists.

Live modes:

```sh
# Local fork only; mainnet reads never use a wallet.
anvil --fork-url "$HSK_MAINNET_RPC" --fork-block-number "$FORK_BLOCK_177" --chain-id 31337
pnpm keeper run --once --exec anvil --target vault --preset balanced
# Human local machine only. Codex must never run this command:
pnpm keeper run --once --exec testnet --target vault --preset balanced
```

The runtime reads `HSK_MAINNET_RPC` for read-only market evidence, `ANVIL_RPC`
(default loopback port 8545) or `HSK_TESTNET_RPC` for execution. Testnet alone reads
`TESTNET_AGENT_KEY` at runtime. No key is printed or saved. Anvil derives public
account #2 from its standard development mnemonic; owner is account #1 and the
deployer must be a third account. Testnet refuses `NODE_ENV=test` or `CI=true`.
Each signing path checks the RPC-reported chain against the selected 133/31337
chain before deriving an account, before simulation, and immediately before
submission. Anvil requires a loopback URL.

T3 manifests live at `contracts/deployments/<chainId>.json`, containing
`vault, router, owner, agent, deployer, block, commit`; `--deployment <path>` can
select another verified manifest. The keeper checks distinct roles, chain owner,
mandate agent/expiry/pause, vault pair/pool/router and router destination.
No deployment addresses are invented. Production manifests still require the
T3 broadcast-verification procedure and ADDRESSES entry. Local integration
addresses are created dynamically, never hard-coded.

Each tick synchronizes sequence/head/trade nonce and balances, collects mainnet
evidence and execution state, selects a validated preset, calls the unchanged
T4 engine, obtains an execution-chain quote for mainnet USD-sized input, and
writes JSON before submitting. Token decimals are read on the execution chain;
mandate/state amounts are normalized to market units for the engine. The actual
execution input and quote are recorded separately in `sources.executionQuote`.
Vault minOut is the maximum of the execution quote slippage floor and the
contract's TWAP floor (same TickMath and negative tick rounding). An unfillable
floor becomes REJECT. Contract checks still run through an `eth_call` preflight.

The `settlement` section appends the mined tx hash, Receipt fields and gas. It
is outside T4's explicitly enumerated receiptHash fields. `tx.data` embeds the
hash and is also excluded, as already specified by T4. A hash-integrity check
runs when reading saved receipts. Mainnet and execution chain IDs are separate.

Only one loop uses a receipt directory. Ticks never overlap. Before any send a
durable `.pending.json` intent is written, and the tx hash is added once known.
Transport retries and replacement transactions are disabled. On restart the
keeper reconciles its JSON with chain Receipt logs (queries in <=5,000-block
chunks) and takes fresh seq/head/nonce. A mined transaction whose settlement
append was interrupted is recovered. An intent without an on-chain Receipt
stops the keeper; it is never automatically resent. After a crash, check the
pending transaction and wallet nonce before manually removing a stale
`.keeper.lock`; unresolved intents require human recovery. Keep the receipt
archive: missing or tampered receipts cause loss reconstruction to fail closed.

The daily loss stop conservatively accumulates positive execution loss at each
receipt's committed mainnet WHSK/USD mark plus actual transaction gas, in UTC
day buckets. It does not net winning fills against losing fills. It is **not**
a portfolio mark-to-market P&L calculation. Unknown daily fills or missing price
marks stop execution. Reaching the policy limit produces REJECT hold receipts.
Router receipts are scoped to the agent's transaction sender; the keeper applies
the live vault mandate as its local envelope, while the router itself remains
permissionless. Its actual event kind is TRADE for both engine TRADE and RESIZE
(the existing router ABI has no kind argument). Router token approvals are exact
and explicitly reset; a failed/uncertain approval/swap stops the loop.

Without an LLM key, `DeterministicChooser` selects the requested preset. A human
can supply `LLM_API_KEY`, `LLM_ENDPOINT`, and `LLM_MODEL` for T4's schema-validated
chooser. No endpoint is guessed. Invalid output causes REJECT, and the LLM cannot
change execution fields. Tests never invoke an LLM.

For fork DEMO, fund the vault predominantly in USDT and set a mandate supporting
$100 clips (TRADE), then lower its cap to $50 (RESIZE); wait for policy cooldown
between trades. `--demo wait` sets zero synthetic basis, and `--demo reject`
removes synthetic CEX data. These are labelled synthetic market scenarios;
real balances, expiry, caps, quotes and on-chain checks remain enforced.

`test/anvil.integration.test.ts` starts a pinned mainnet fork, deploys the vault
and router with viem, sets a mandate, funds USDT by local-only impersonation,
and exercises the CLI with a stub collector for TRADE/WAIT/RESIZE/REJECT. It
checks receipt hashes, zero allowance, owner revoke and a forced reverting trade.
It clearly skips without Anvil/RPC; with those available, missing artifacts are
built with forge and contract/assertion failures fail the test. Network preflight
failure is also an explicit skip. All broadcasts in tests target loopback 31337.

Typed ABI subsets are manually exported from contract public declarations in
`packages/core/src/abi/index.ts`; `forge build && node scripts/export-abis.mjs`
exports full typed artifact ABIs alongside them. `twap.ts` ports the repository's
Uniswap TickMath implementation under GPL-2.0-or-later, with the same attribution.
