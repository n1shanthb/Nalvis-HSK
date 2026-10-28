# Core

Pure decision logic, canonical commitments, read-only evidence collection and two
explicitly separate replay modes. Mainnet 177 supplies market evidence; execution
is restricted to testnet 133 or local fork 31337. Testnet prices are not real.

## Policy and decisions

`policySchema` validates `policy/default.json`. The file is canonical JSON **with
no trailing newline**, so the T3 Solidity helper's hash of its exact bytes equals
`policyHash(policy)`. Defaults and preset names are part of the hash.
`clampToMandate(policy, mandate, decimalsB)` validates every preset's target,
cooldown, tokenB clip and daily cap; it refuses a wider envelope rather than
silently changing a signed policy. TokenA caps require a current price and are
checked against the actual integer quote input by `decide`.

`decide(evidence, policy, mandate, state)` performs no IO or clock reads. Supply
UTC unix seconds in evidence, explicit balances and day-bucket state. Invalid
schemas/sources, stale DEX (>6h by default), missing/old/wide/divergent CEX books,
fresh APRO disagreement, invalid LLM selection, revoked/expired mandates, a policy
hash mismatch and exhausted daily/loss limits reject. Expiry is inclusive, as in
the vault. Stale APRO is recorded as `apro_stale_ignored` and does not itself
reject. Data checks precede mandate checks, then cooldown, target band, direction
and size selection. Quotes are sorted by policy size descending. Costs come from
each size's quoted output versus spot mid; no execution costs/prices are embedded
in the engine. The largest feasible positive-edge clip trades; a smaller clip
resizes. Missing selected-direction quotes reject; no affordable positive-edge
clip waits. Exposure above a cap permits strict risk reduction, matching T3.

`amountIn` and `minOut` are bigint token units. The slippage floor rounds down as
the contract does. Optional quote `twapFloor` is the **already slippage-adjusted**
on-chain minimum in output units: minOut is raised to it, and quotes unable to
fill it are excluded. Unknown TWAP is not represented as a guessed floor.
A downstream executor must obtain/validate execution-chain quotes and TWAP before
submitting anything; this module never signs or broadcasts.

Market quotes use the market token decimals (WHSK 18 / USDT 6). The collector's
optional vault snapshot carries its own decimals (USDT 18 on 133), at a separate
execution block. Do not feed testnet balances into a mainnet-valued state or reuse
mainnet quote amounts as testnet calldata. Callers must make the portfolio's unit
system explicit; `decide` uses `evidence.decimalsA/B` throughout.

## Evidence and fixtures

`collectEvidence({marketClient177, execClient, vault?, sizes, fetcher?, clock?})`
accepts only read/simulate clients. It pins one market block for **all** pool,
balance, oracle and QuoterV2 calls, plus a separately pinned execution block for
vault reads. Failed pins prevent unpinned fallback reads. QuoterV2 is non-view:
it uses `simulateContract` (eth_call), never a write. HTTP CEX/subgraph sources
cannot be atomically pinned with RPC; their retrieval times and raw bodies are
committed. Subgraph indexing lag and actual CEX quote-generation age remain
UNVERIFIED; book APIs provide no exchange timestamp, so freshness is measured
from retrieval. All responses pass zod schemas. Individual failures preserve
`{error, raw}` and cause engine rejection. Mainnet API calls are read-only.

Every source records `{url|address, method, raw, fetchedAt}`; RPC sources also
record `chainId` and `blockNumber`. `evidenceHash` commits the complete pack.
Use `parseEvidenceJSON` to reload canonical bigint strings: only declared integer
fields are restored; raw source payloads remain unchanged. Both representations
have the same canonical hash.

`test/fixtures/recorded-evidence.json` is a real read-only capture (18 sources,
8 directional quotes; block/time are inside the file), with no wallet or keys.
The tests validate/re-hash it fully offline. `synthetic-evidence.json` and
`receipt.golden.json` use clearly labelled synthetic prices for branch tests.
The eight `data/research/` inputs are verbatim frozen user attachments.

## Receipts: exact v1 commitment

`buildReceipt` returns these exact top-level fields:

- `version` (1), `chainId` (legacy alias for execution chain), `marketDataChainId`,
  `executionChainId`, `contract`, `seq`, `prevHead`;
- `policyHash`, `evidenceHash`, `evidence`, `decision`, `ruleTrace`;
- `llm: {explanation, model?, promptHash?, outputHash?}`;
- `tx: {to, data, minOut, deadline, nonce}`;
- `receiptHash`.

`receiptHash` is keccak256 of UTF-8 canonical JSON of exactly the above fields
**excluding `receiptHash` and `tx.data`**. All other tx fields are committed.
Calldata embeds receiptHash and therefore cannot be included without a circular
commitment. Rule traces appear inside `decision` and as the required top-level
field. Omitted optional LLM fields are absent, never undefined. `seq`, nonce and
amounts become decimal strings in canonical JSON. The golden file freezes the
entire shape and its hash; changing it requires an explicit version review.
This hash is distinct from the contract's ABI-encoded receipt-chain head hash.
Canonical encoding sorts keys by UTF-16 order, uses ECMAScript JSON number
formatting, adds decimal-string bigint support, and rejects undefined/nonfinite
numbers, sparse arrays, cycles, non-plain objects and invalid Unicode.

## Optional LLM

`DeterministicChooser` is the default. `OpenAICompatibleChooser` takes an explicit
endpoint/model and only uses a key provided via `LLM_API_KEY` or constructor.
No endpoint is contacted by default or in unit tests. `choosePreset` validates the
fixed enum, the supplied allowed set and the output shape; invalid output returns
a deterministic fallback, transcript hashes and a failing rule trace. Pass its
`valid` flag into `state.llmValid` so that the engine rejects that cycle. The
chooser never changes engine prices, amounts, verdicts or transactions.
`nlToParamDiff` supports a conservative preset and explicit tokenB maxTradeIn
reductions; widening requests require a new Ledger-signed mandate. Unrecognised
text produces no change.

## Replay and validation

```sh
pnpm --filter core backtest
pnpm --filter core test:coverage
pnpm test
pnpm lint
RUN_NETWORK_TESTS=1 pnpm --filter core test
cd contracts && forge test
```

The reference TS port preserves the frozen Python constants, grid, first-maximum
tie choice, 360/360 split, both marks and Python binary round-half-even behavior.
An offline test deep-compares **every** result with `backtest.json`.
The engine replay passes each historical row through `decide` sequentially; it
does not select a preset or tune parameters against future rows. Its synthetic
cost model interpolates only within `hsk_probe.json`'s measured curve, using half
the measured round-trip percentage. That is a fixed **ex-post calibration**,
not a claim that these quotes were available historically. Historical books,
APRO, liquidity and quotes are not available. The report labels those inputs as
synthetic and excludes gas, later price impact and exit costs. It shows **no
proven edge**. See `backtest/REPORT.md` for the captured output and limitations.

The opt-in network test requires reachable RPC/HTTP services. With Node 22 in a
proxy environment, enable its `--use-env-proxy` support; default tests use no
network. Engine coverage is enforced at 100% branches; helper behavior is also
covered by targeted risk/quote and collector tests.

## Keeper settlement extension

T5 appends `settlement: {transactionHash, blockNumber, status, log, gasUsed,
effectiveGasPrice}` after mining. `receiptHash()` enumerates its input fields
explicitly, so settlement is excluded and the v1 commitment/golden file remains
unchanged. Execution quotes and keeper state are committed inside evidence
sources; engine amounts remain mainnet units while execution amounts use the
execution token decimals. See `packages/keeper/README.md`.
