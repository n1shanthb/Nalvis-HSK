# Research fixtures (frozen, read-only)

These are inputs for tests and replay. They were collected 26–28 Oct 2026 by read-only RPC, subgraph and CEX queries. Do not edit them; add new files instead.

| File | What |
|---|---|
| `market_history.json` | 30-day hourly series to 27 Oct 2026 21:34 IST: `basis_series[] = {hour (unix s), dex (USDT/WHSK), cex (USDT/HSK), basis_pct}`, plus a summary |
| `backtest.json` | Output of `backtest_reference.py` (the parity target for the TS port) |
| `backtest_reference.py` | The reference replay. Running `python3 backtest_reference.py` in this folder regenerates `backtest.json` byte-for-byte (checked 28 Oct). |
| `hsk_probe.json` | Mainnet probes: QuoterV2 cost curve, gas, pool state |
| `testnet_quote.json`, `testnet_state.json` | Testnet pool state and quotes (fake prices) |
| `recon.json` | Address and pool reconnaissance |

The caveat in `backtest.json` applies: this is a replay only, **not** evidence of profitability.
