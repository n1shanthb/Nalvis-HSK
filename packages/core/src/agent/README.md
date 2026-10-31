# T12 autonomous strategist library

The agent owns its strategy and watch timing. Only execution is bounded by the
Ledger mandate and execution plumbing. **Your Ledger signature fixes which models
and prompts may trade, and the limits; the agent can do anything else inside them.**
Execution is a testnet sandbox priced by its own pool. Testnet prices are not real;
mainnet 177 evidence is read-only. No profit or alpha is claimed.

This is a library, not an always-on service. Service hosting, live feed endpoints,
dashboard wiring and deployment instructions belong to T12B. No contracts or
existing desk/chooser/engine code are changed.

Import the server library from `agent/index.js`. Construct a `Provider` with
`openRouter(env, fetch, optionalPerModelRates)`, a `Store` with
`jsonFileStore(root)`, and `createAgent({provider,store,clients,config})`.
`configFromEnv(exactPolicyFileBytes)` parses the documented environment variables.
Model identifiers are selected through configuration. The strategist and fitter
use only `AGENT_OPENROUTER_API_KEY`, never the desk's `OPENROUTER_API_KEY`. The
agent does not read or change `DESK_AI_ENABLED`; the example configuration keeps
desk AI disabled until its separate rate-limit and spend-cap work lands. A missing dedicated agent key or strategist model
makes the agent OFFLINE: it continues polling cheap evidence and never calls a
model, sends a transaction, or falls back to rules. Offline state is recorded at
most once per hour. Only explicitly selecting `AGENT_MODE=rules-demo` enables
`decide()`; its inputs are supplied by `clients.rulesDemo()`, and journals and
receipts identify that mode.

## Injection boundaries

`tick(now)` receives UTC Unix seconds and merges eligible watches into one wake;
`wake(fired)` is the explicit wake entry point. Calls never overlap. The service
must ensure one writer per store root. Inject these clients:

- `evidenceLite()`: cheap market reads (pool slot0/liquidity, CEX tickers, APRO,
  recent subgraph swaps), plus deduplicated vault owner events. A `Paused(bool)`
  contract event maps to `Paused` or `Unpaused`. Store/replay a durable event cursor
  in the service. No transactions on 177.
- `collectEvidence()`: call existing `collectEvidence` afresh for each wake.
  The result and all external text enter the canonical **user data** message;
  neither system prompt changes in response to evidence.
- `readState()`: use `readMandateState(publicClient,vault,block?,agent?)`. Reads
  are block-pinned, with live pending transaction checks. The private rolling
  turnover buckets are reconstructed from Receipt events in <=5,000-block chunks
  and checked against `dailyNotionalB()`. This is a rolling 48 x 30-minute window,
  **not** the historical calendar-day alias in older docs. Missing history fails
  closed. Retain archive RPC access for verification.
- `quote(action,state)`: use `amountFor` then obtain an execution-chain quote at
  `state.block`. Return `{block,at,amountIn,amountOut}` in raw token units. SELL
  sizing uses the execution TWAP and execution decimals, never mainnet dexMid.
  For projected fitter legs, quote the current execution curve under the supplied
  projected balances/time; this is a planning assumption, never an authorization
  to send a later leg. Later legs only create system retry watches and always
  require a fresh strategist confirmation, fresh state/quote and simulation.
- `simulate(state,prepared,receiptHash?)`: use exported `simulate`; decoded vault
  custom errors become violations. Quotes cannot account for every router/token
  behavior; the vault's `eth_call` is the final judge.
- `send(receipt)`: perform the last RPC chain/head/trade nonce/wallet pending nonce
  guards and simulate the exact `calldata(receipt.final,receipt.receiptHash)`
  immediately before signing; no transport retries or replacements. Check chain
  133/31337 before constructing any signing client and again before sending.
  Codex tests only send to local Anvil 31337. No keys are accepted by this library.

The agent refreshes all state after model/fitter calls, checks the final action,
simulates it, refreshes and checks once more, then simulates hash-dependent
calldata before writing the durable pending intent. An unresolved pending intent
blocks restart sends; the service must reconcile against the on-chain Receipt and
wallet nonce before clearing it. There is no automatic resend.

Budget accounting persists every model completion. The hourly wake window is
rolling; the USD budget resets at the UTC day boundary. All fit/repair calls
consume budget. OpenRouter usage accounting is requested on every call. Returned cost takes priority
(`costSource: openrouter`); otherwise the per-model configuration in
`config/model-rates.ts` supplies USD per million input/output tokens
(`costSource: estimate`). Unknown models use a labelled conservative $1/$3 per
million input/output tokens, not a flat per-call charge. Missing token counts use
a conservative UTF-8-byte estimate plus message framing. Journal entries retain
the selected rates, token counts and whether a model, custom or default rate was
used. The injected rate override remains available for other models.

## Policy and receipt commitments

Build an exact canonical policy file with `createAgentPolicy(config,extra)`.
Its `strategyHash` binds OpenRouter, both configured model identifiers, the two
versioned prompts, schema version, watch bounds and fit rounds. `agentPolicyHash`
hashes the **exact UTF-8 file bytes**, matching `MandateCalldata.s.sol`, including
any final newline. Have the Ledger owner sign that policy hash. A mismatch enters
NEEDS_OWNER without execution. Provider model configuration must match the signed
strategy. OpenRouter's returned model identifier and usage are recorded as well.

The store contains `policy.json`, `journal.jsonl`, `prompts/<hash>.json`,
`evidence/<hash>.json`, `states/<hash>.json`, `watches.json`, `runtime.json`,
`pending.json`, and `receipts/<hash>.json`. Archive the entire root, not only the
receipt files. JSON files use atomic rename and fsync; journal appends are fsynced.
A truncated or reordered journal refuses restart.

v3 hashes **every receipt body field**, excluding only `receiptHash` itself and
post-mining `settlement`. Calldata is derived from the committed final fields,
not included recursively. A receipt commits `journalFrom` (exclusive) through
`journalHead` (inclusive). The ACTION entry containing this receipt's hash is
written after send and belongs to the **next** anchored range, avoiding a circular
hash. When there is no trade, eligible wakes emit at most one WAIT hold anchor per
`AGENT_ANCHOR_SEC`; the system heartbeat ensures continued wake opportunities.
The final fitted smaller trade is labelled RESIZE. Long-horizon planned legs are
retry watches, never pre-signed transactions.

Run `pnpm verify <receipt.json> --rpc <execution RPC> --agent-root <root>`.
The verifier checks full journal hashes, prompts/inputs/outputs, bounds replay,
recorded mandate snapshots (and historical chain state with an RPC reader), final
acceptance, calldata, events and policy binding. Missing artifacts fail closed.
**Model outputs are recorded and bound, not reproduced.** v1/v2 hashing and
verification remain unchanged. Receipt-level P&L aggregation is still a v1/v2
feature; v3 verification does not claim testnet P&L is real.

## Tests

`pnpm test` uses mocked fetch/provider responses, no hosted model calls or keys.
Install Foundry and build `contracts` to run local Anvil tests. `ANVIL_BIN` may
select an Anvil executable; otherwise it is read from PATH. Local tests deploy
unchanged vault/token/pool/router artifacts at dynamically returned addresses,
exercise >=200 seeded random check-vs-eth_call cases, and produce a three-wake
v3 run with a fitted trade and anchors. They verify tamper failures. Without
Anvil the integration cases are visibly skipped; no fabricated PASS is reported.
