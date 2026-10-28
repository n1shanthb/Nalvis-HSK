# Engine replay output

Command: `pnpm --filter core backtest`

```json
{
  "label": "Synthetic engine replay: no proven edge",
  "hours": 720,
  "counts": {
    "TRADE": 0,
    "RESIZE": 0,
    "WAIT": 497,
    "REJECT": 223
  },
  "finalEquityDex": 951.16,
  "holdDex": 951.16,
  "excessVsHoldDex": 0,
  "maxDrawdownPct": 7.09,
  "limitations": "Fixed ex-post measured round-trip/2 curve; no future history rows used by decisions. Historical two-venue books, APRO, block state and size quotes unavailable: explicitly synthetic. Gas and impact on subsequent prices excluded; marks before exit cost. Not evidence of profitability."
}
```

Reference parity: all fields deep-equal `data/research/backtest.json`.
D_dislocation OOS DEX mark: excess vs hold $0.49, 38 trades,
93 rejected signals, maximum drawdown 5.35%. No proven edge.

The default 5% rebalance band holds the portfolio throughout this window.
Zero excess is not evidence that any active strategy is profitable.
