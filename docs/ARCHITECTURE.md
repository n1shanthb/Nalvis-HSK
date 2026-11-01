# Architecture and integration status

Nalvis separates read-only market observation, deterministic decision-making,
transaction execution, and independent receipt replay. It does not claim a
profitable strategy; the research result is **no proven edge**.

## Data and decision path

1. `packages/core` validates policy/evidence, reads chain 177 as market-data
   only, and computes a deterministic `TRADE`, `RESIZE`, `WAIT`, or `REJECT`.
   It uses explicit timestamps in evidence, never a clock or randomness in the
   decision function. Quotes and pool TWAPs supply measured costs.
2. `packages/keeper` reads evidence and execution state, replays the decision,
   builds a canonical receipt, then either persists an unsigned `dry` receipt
   or submits through the configured vault/router execution adapter. On a
   successful on-chain decision it joins the transaction receipt to the
   emitted `Receipt` event and appends settlement data.
3. `packages/verifier` independently checks canonical hashes, evidence,
   policy, deterministic replay, event fields, chain head, and settlement.
   The offline recorded fixture is explicitly replay evidence, not live-chain
   proof.
4. `apps/dashboard` is a browser application. It reads deployment JSON served
   by Vite, reads contracts directly through read-only RPC, fetches market
   evidence, displays locally served receipts alongside matching chain logs,
   and offers an optional Ledger owner panel. Chain-133 testnet values are
   visibly labeled as not-real prices.
5. Solidity contracts implement the actual enforcement boundary. EdgewiseVault
   applies its mandate, pause/revocation, interval, cap, drawdown, TWAP and
   receipt rules. ProofTradeRouter has a fixed SwapRouter02 destination and a
   policy hash, but is permissionless per caller and does not itself enforce
   the vault's mandate caps.

There is no standalone backend API service in this repository. The frontend
uses browser RPC and public market-data APIs (with an optional local Vite CEX
proxy); the keeper is the data-gathering/execution CLI. Vite serves only the
selected JSON deployment/receipt directories.

## Network and signing boundaries

- Market evidence: HSK Mainnet 177, read-only calls only.
- Actual writes: chain 133 only, behind chain and human-run guards. Chain 31337
  is local Anvil only.
- No application source contains a private key. The current keeper's optional
  testnet execution adapter expects the agent key from a local runtime
  environment variable; do not run it unless that existing local secret
  mechanism is acceptable to the operator. The repository has no encrypted
  keystore-signing adapter for the keeper.
- The browser owner flow uses Ledger WebHID and blind signing on chain 133.
  No Ledger was connected in this audit.
- APRO is off-chain evidence only. The deployed vault has no oracle configured.

## Important execution limitation

The vault holds no WHSK or test-USDT at the verified snapshot. The keeper's
`dry` mode is synthetic and cannot broadcast; local scenario receipts use a
zero-address sentinel and are not eligible for on-chain verification. The
ProofTradeRouter fallback is not equivalent to vault-enforced mandates and
must not be presented as one. Until safely funded and validated, use local
fixtures and Foundry tests only.

## Receipt trust boundary

A decision JSON is not an on-chain receipt by itself. A trustworthy execution
requires a successful receipt transaction, exactly one matching contract
`Receipt` event, expected sequence/previous head/policy hash, and independent
verifier PASS. Local synthetic decision files are marked demo and provide only
replayable decision/hash evidence.
