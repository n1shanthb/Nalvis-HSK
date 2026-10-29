# Verifier

Read-only verification of a keeper receipt against the execution chain. Build
with `pnpm -r build`, then:

```sh
pnpm verify receipts/31337/<seq>-<receiptHash>.json --rpc http://127.0.0.1:8545
pnpm verify <txHash> --receipt receipt.json --rpc http://127.0.0.1:8545 --chain 10
pnpm verify <txHash> --receipts receipts --rpc http://127.0.0.1:8545 --json
pnpm verify --pnl receipts/31337 --rpc http://127.0.0.1:8545 --json
```

Exit 0 is PASS; exit 1 is FAIL, with the failing check named. Without `--receipt`,
a transaction hash is located recursively under `receipts/` (or `--receipts`).
RPC defaults to `ANVIL_RPC`, then `HSK_TESTNET_RPC`, then localhost. The RPC must
report the receipt's execution chain ID. The verifier never signs or sends a
transaction. Historical contract calls require archive state at the mined block.

`--chain N` verifies up to N preceding on-chain receipts, stopping at genesis;
default 1, maximum 10000, zero checks only the current link/head. Searches walk
backward in <=5000-block queries. The current receipt's computed head is checked
against the historical contract head, accounting for any later receipts in the
same block. Router histories are isolated by transaction sender. Verification
covers the JSON commitment, replay inputs, mined transaction/calldata, emitting
contract, all committed event fields, and predecessor links. RPC results are the
chain data source; offline recordings cannot establish live-chain authenticity.

The independent canonicaliser imports neither the core encoder nor its receipt
projection. Both evidence encodings and both receipt hashes must agree. The
receipt projection remains core v1: calldata and post-mining settlement are
excluded; tx.to/minOut/deadline/nonce remain committed. Replaying uses the policy,
mandate, and final state in `evidence.sources.replay.raw`; the policy must hash to
the receipt and mandate policyHash. It requires the entire engine result,
including size, direction, minOut and rule trace, to match. Engine minOut is in
market units; tx.minOut is in execution units, and is checked separately against
the committed execution quote, the event, calldata and TWAP floor.

Old T5 receipts that lack exact replay inputs fail `replay_snapshot`; the
verifier never substitutes today's policy. A post-engine keeper rejection caused
by an unavailable execution quote also fails `decision_replay` rather than
claiming that `decide()` returned the keeper's substituted verdict.

Metrics use mined amounts, token decimals read at the execution block, the pool
fee rate, and mined gasUsed × effectiveGasPrice. Realised price is tokenB/tokenA;
positive slippage bps means an adverse fill (`(reference - actual)/reference`).
Pool fee input units are the configured fee fraction of the full input, rounded
up; per-tick fee rounding is not reconstructed. USD gas uses the arithmetic mean
of evidence CEX bid/ask mids. Missing CEX data on a hold gives USD `null`, not a
made-up price. Labels always distinguish `testnet — prices not real` and local
Anvil. Values are display estimates, not a claim of profit.

P&L requires individually verified receipts from one contract/chain with
contiguous sequence numbers and hashes. It starts with the first stored pair
inventory, applies actual fills, marks both strategy and untouched inventory at
the last available evidence CEX mid, and subtracts gas once. Fees are already in
the fills. Assumptions: no intervening deposits/withdrawals, tokenB/USD peg,
native HSK valued using the evidence CEX reference. A hold without a CEX mark
uses the last available mark for its gas valuation; the report identifies the
mark's sequence. Mainnet evidence prices and testnet execution prices are
separate; testnet P&L is not real.

## Recorded acceptance fixtures

```sh
pnpm verify packages/verifier/test/fixtures/receipts/0-0x7b0c0e534f5f1143aa6be5b1fc80e826fc620453d80b9e517cd9dcdddd352a2d.json --recorded packages/verifier/test/fixtures/chain.json
pnpm verify --pnl packages/verifier/test/fixtures/receipts --recorded packages/verifier/test/fixtures/chain.json --json
```

`--recorded` explicitly prints **recorded RPC replay (offline; not live chain
proof)**. The four receipts are real mined TRADE/WAIT/RESIZE/REJECT transactions
from a local fork; see `test/fixtures/README.md`. Default tests are offline.
The T5 fork integration now runs the keeper CLI and verifier CLI against live
local RPC for all four decisions, including all predecessor links and revocation.

```sh
pnpm --filter @nalvis/verifier test
pnpm --filter @nalvis/keeper test -- test/anvil.integration.test.ts
```

To regenerate recordings, set `VERIFIER_FIXTURE_DIR` to an empty scratch
directory before the second command and inspect its outputs before replacing
fixtures. Foundry must be on PATH and HSK_MAINNET_RPC/FORK_BLOCK_177 must be set.
On Node versions supporting it, proxy environments need `NODE_USE_ENV_PROXY=1`
and `NO_PROXY=localhost,127.0.0.1`. RPC reachability failures explicitly skip the
fork test; contract/assertion failures fail it. No secrets or private keys are
recorded. Only public Anvil development accounts sign, on local chain 31337.
