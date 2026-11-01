# Testing and verification

Run the local checks from repository root. Tests use deterministic fixtures
and local mocks; they do not call a real LLM or send HSK Testnet transactions.

```powershell
pnpm -r build
pnpm test
pnpm lint
Set-Location contracts
forge fmt --check
forge build
forge test
Set-Location ..
```

The four decision outputs are exercised by the core engine and keeper fixture
tests: TRADE, RESIZE, WAIT, and REJECT. Engine tests cover cooldown, expiry,
revocation, daily loss/turnover, exposure and market-quality conditions. The
vault's Solidity tests cover authorization, caps, slippage, interval, pause,
revoke, drawdown, receipt links, and failure cases. Foundry fork tests are
network-dependent; a skipped fork/oracle assertion is not a successful live
execution.

Receipt verification has two separate meanings:

- Unit tests replay and hash deterministic/synthetic decision receipts locally.
- `packages/verifier` can independently verify a mined transaction against RPC
  or a committed recorded Anvil fixture. The latter is reported as an offline
  recorded replay, not live-chain proof.

The dashboard tests use mocked RPC, mocked Ledger signer and saved verifier
recordings. No Ledger, wallet signature, funding action, or chain write is
performed by the test suite.

Latest validated local results:

| Check | Result |
|---|---|
| `forge fmt --check` | Passed |
| `forge build` | Passed |
| `forge test` | 155 passed, 0 failed, 1 optional fork test skipped without RPC |
| Chain-133 fork integration | 13 passed, 0 failed; local fork simulation only, no broadcasts |
| `pnpm -r build` | Passed; Vite reports a large-chunk advisory |
| `pnpm test` | 181 passed, 0 failed, 2 optional RPC tests skipped; workspace scheduling is sequential to avoid worker exhaustion |
| `pnpm lint` | Passed |
