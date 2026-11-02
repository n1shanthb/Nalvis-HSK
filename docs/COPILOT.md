# Nalvis Copilot

Copilot translates requests and displays read-only evidence or a reviewed,
owner-directed USDT-to-WHSK buy or WHSK-to-USDT sell. The LLM does not construct, sign or submit
transactions and does not override the autonomous agent's verdict. Existing
autonomous policies, mandate gates and contract addresses remain unchanged.

## Owner confirmation

Only the connected on-chain vault owner in their own workspace can authorize a
session. The selected Ledger account signs a readable EIP-191 delegation for a
browser-generated key: BUY or SELL within the mandate, one vault, chain and current policy hash, at
most 15 minutes. The key remains in memory and is destroyed on page close,
account change or ending the session. Ending a session does not cancel an order
already confirmed and queued. Pause/revoke remain the on-chain emergency controls.

Each explicit Confirm signs the exact reviewed amount, minimum output, nonce,
receipt sequence/head and a quote lifetime of at most 90 seconds. Further orders
in the same session do not require another Ledger prompt. Reject submits nothing.
The server validates both signatures; the keeper independently repeats them,
reads fresh state/quotes and simulates under its existing single-writer lock.
Changed or expired orders are rejected, never silently resized or repriced.
All existing on-chain mandate checks still apply. Proceeds remain in the vault.

A sell is a capped clip; a buy uses the exact reviewed USDT input. Additional legs are never automatically scheduled.
Zero WHSK means no executable sell; insufficient USDT means no executable buy. Profit/loss is unavailable without verified
cost-basis history. Quoted output and estimated gas are not guaranteed settlement.
Public viewers have no trading authority. A Redis credential or server request
alone cannot authorize a swap; the agent private key remains only on OCI.

## Configuration

Vercel server variables (never `VITE_` secrets):

- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DESK_AI_ENABLED=true`.
- `DESK_IP_HASH_SECRET` and Upstash `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
- `COPILOT_TRADES_ENABLED=true` only after the OCI worker is running this version.

OCI requires the same Redis REST URL/token and opt-in flag, in a supplemental
mode-600 env file, alongside its existing agent env. No agent signing key goes to
Vercel. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` aliases also work.
Missing/invalid Redis configuration disables order processing without changing
autonomous strategy. Redis request limits also protect the Copilot AI endpoint;
they count requests rather than guaranteeing a dollar spend ceiling.

The queue atomically deduplicates confirmations and claims each order once.
Queue/status entries expire after one hour; durable receipts, replay markers,
intents and journal remain in the OCI data volume. Ambiguous submissions are
never automatically resent. Restart reconciliation uses the transaction hash
persisted before broadcast and the independent verifier. Infrastructure outages
may require manual review rather than claiming a swap succeeded.

## Receipt version 4

Owner-directed buys and sells use version 4, explicitly distinct from autonomous version
3 receipts. Existing receipt formats and hashes are unchanged. The v4 hash is
`keccak256(utf8(canonical(body)))`, excluding only `receiptHash` and post-mining
`settlement`. The exact committed body fields are:

`version`, `marketDataChainId`, `executionChainId`, `contract`, `seq`, `prevHead`,
`policyHash`, `evidenceHash`, `strategy`, `intent`, `fit`, `final`, `mandateCheck`,
`journalHead`, `journalFrom`, `simulation`, `authorization`, `owner`, `state`, `quote`.

`authorization` includes the owner delegation, owner signature, exact order and
browser-key signature. `strategy.mode=owner-command`, provider `owner-session`,
models `none`; no fictitious model transcript is generated. The verifier checks
signatures, historical owner/state, mandate replay, artifacts/journal, exact
calldata, sender, receipt event, output floor, expiry and chain head. Local
integration tests perform buys and sells under one delegation, verify both, reject
tampering and replay, and rehearse a mined transaction followed by a disconnect.

No contract redeployment or mandate replacement is required. This feature does
not establish profitability: no proven edge.
