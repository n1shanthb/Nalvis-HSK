# Nalvis-HSK - HSK Chain Horizon Hackathon Track 1 (verifiable Ledger-mandated trading agent)

## Development

```bash
nvm use
corepack enable
pnpm install
git submodule update --init --recursive
pnpm -r build
pnpm test
pnpm lint
(cd contracts && forge build && forge test -vvv)
pnpm dev
```
