# Nalvis-HSK — bounded, verifiable testnet execution

Nalvis is a Ledger-governed trading-agent prototype for HSK Chain Horizon Track 1.
It combines a deterministic, cost-aware rebalancing engine with on-chain
mandate checks and hash-chained receipts. The research backtest shows **no
proven edge**; the product demonstrates bounded, inspectable execution, not
profit.

## Current HSK Testnet status

The deployed EdgewiseVault and ProofTradeRouter are on HSK Testnet (chain 133).
The vault mandate and router policy are configured and read back from chain;
both use policy hash
`0xabeadf083e801ceaed5a290b5800095cd7243a791fe72419172017b32b048027`.
The vault currently holds zero WHSK and zero test-USDT, so no funded trade can
be demonstrated. No testnet trade receipt is claimed. Testnet pool prices are
not real.

| Contract | Address |
|---|---|
| EdgewiseVault | [`0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc`](https://testnet-explorer.hskchain.net/address/0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc) |
| ProofTradeRouter | [`0xC5Fa869C8423B41696886A7761ec31b3846f4e4B`](https://testnet-explorer.hskchain.net/address/0xC5Fa869C8423B41696886A7761ec31b3846f4e4B) |

The temporary owner remains in place. Ledger handover is pending a separately
verified Ledger address and explicit authorization. See
[docs/OWNERSHIP-HANDOVER.md](docs/OWNERSHIP-HANDOVER.md).

## Components and runbooks

- [Architecture](docs/ARCHITECTURE.md) — components, trust boundaries, and
  current integration limitations.
- [Deployment state](docs/DEPLOYMENT.md) — confirmed deployment and
  configuration transactions.
- [Testing](docs/TESTING.md) — reproducible checks and verified test results.
- [Demo guide](docs/DEMO-GUIDE.md) — local scenarios and presentation steps.
- [Ownership handover](docs/OWNERSHIP-HANDOVER.md) — two-step transfer for
  both contracts.
- [Verified address book](docs/ADDRESSES.md) — only approved protocol
  addresses.

## Local development

Requirements: Node 22, pnpm 9, Foundry, and initialized Git submodules.

```powershell
nvm use
corepack enable
pnpm install
git submodule update --init --recursive
pnpm -r build
pnpm test
pnpm lint
Set-Location contracts
forge build
forge test
Set-Location ..
pnpm dev
```

Never point a signing or write workflow at chain 177. Mainnet is read-only;
testnet prices are simulated-market context and not real-world prices. Do not
fund, approve, sign, transfer ownership, or execute a testnet trade without
separate human authorization.
