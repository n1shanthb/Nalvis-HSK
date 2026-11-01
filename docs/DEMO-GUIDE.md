# Hackathon demo guide

## Honest status to state first

Nalvis demonstrates a deterministic decision engine and receipt-proving
execution architecture. The backtest shows **no proven edge**. HSK Testnet
prices are not real. The deployed vault mandate and router policy are
configured, but the vault currently has zero WHSK and zero test-USDT. Therefore
there is no funded testnet trade, on-chain scenario receipt, or realized testnet
P&L to present. Ledger ownership handover is pending a verified Ledger address
and separate authorization.

## Components and live records

Show the four stages: evidence gathering (mainnet 177 read-only), pure policy
decision, EdgewiseVault mandate checks and receipt commitment, then independent
verifier replay. ProofTradeRouter is a permissionless fallback and does not
enforce vault mandate limits; do not present it as an equivalent governed route.
The current deployment/configuration and transaction links are in
[DEPLOYMENT.md](DEPLOYMENT.md).

On the dashboard:

1. Select **HashKey testnet · 133** and note the banner that testnet prices are
   not real.
2. Open **Mandate** to display on-chain owner, agent, caps, expiry, pause state,
   vault policy hash and router policy hash. The dashboard compares both policy
   hashes at one pinned block.
3. Open **Live evidence** to show read-only mainnet pool data and quote costs;
   indicate any stale/missing source instead of hiding it.
4. Open **Decisions & receipts**. A local fixture receipt is explicitly marked
   local/unverified unless a matching on-chain event and transaction are found.
5. Open **Verify** and replay the recorded fixture. Call out that it is offline
   recorded-chain evidence, not a Testnet transaction.

## Run deterministic local scenarios

From the repository root, build the TypeScript workspace and run each
synthetic scenario without signing or sending:

```powershell
pnpm -r build
pnpm keeper run --once --exec dry --demo trade --receipts receipts/demo
pnpm keeper run --once --exec dry --demo resize --receipts receipts/demo
pnpm keeper run --once --exec dry --demo wait --receipts receipts/demo
pnpm keeper run --once --exec dry --demo reject --receipts receipts/demo
```

These are synthetic decision outputs, not valid on-chain transactions. The
keeper labels them `DEMO`; their receipt hashes can be checked locally by the
keeper and unit tests, but the chain verifier cannot claim an on-chain PASS for
them. The real verifier demonstration is:

```powershell
pnpm -C packages/verifier run verify packages/verifier/test/fixtures/receipts/<fixture-file>.json --recorded packages/verifier/test/fixtures/chain.json
```

Use the receipt filename present in that fixture directory. Its output says
`recorded RPC replay (offline; not live chain proof)`.

## Pause and revoke safety demonstrations

Do not call pause, revoke, setMandate, or any other owner function on the
deployed contracts for a demo. Show the corresponding local Foundry tests
instead:

```powershell
Set-Location contracts
forge test --match-path "test/unit/EdgewiseVault.t.sol"
Set-Location ..
```

This proves only the local test contract behavior. No Testnet PAUSE/REVOKE
state change is claimed.

## Successful live trade checklist (not currently met)

Before any separate human-authorized execution, the operator must verify
balances and pool/TWAP/quote health; acquire test tokens through a reviewed
process; ensure the keeper agent signer is local and distinct from owner and
deployer; confirm chain ID 133; confirm mandate is live, unpaused and policy
hash matches; and review exact approval/allowance behavior. Test-USDT and WHSK
balances are currently zero. No approval or funding should be performed
without explicit authorization. Do not broadcast on chain 177.
