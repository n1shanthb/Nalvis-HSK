# Nalvis dashboard

React 19 / Vite / viem dashboard with hash routes `#/mandate`, `#/evidence`,
`#/receipts`, and `#/verify`. Mainnet 177 is read-only. Execution views can also
select testnet 133 or local Anvil 31337. No proven edge is claimed.

From the repository root (Node 22 and pnpm 9):

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm --filter dashboard build
pnpm --filter dashboard preview
pnpm test
pnpm lint
```

## Deployment and receipt inputs

The Vite plugin serves JSON files from `contracts/deployments/` as `/deployments/`
and from `receipts/` as `/receipts/`. It emits the same assets at build time for
preview/static hosting, together with `/receipts/index.json`. Rebuild static
hosting to refresh those assets. Never place keys or secret JSON in either
public directory. The plugin does not expose other repository files.

Deployment manifests use the T3 shape: `vault`, `router`, `owner`, `agent`,
`deployer`, `block`, and `commit`. Structural contract addresses must first be
verified and listed in `docs/ADDRESSES.md`; the dashboard refuses unlisted
contracts. There is currently no verified network deployment. The initial UI
therefore reports the mandate and on-chain receipts as unavailable. It does not
substitute fixture addresses or synthetic market prices. Anvil RPC is loopback
`http://127.0.0.1:8545`; fixture addresses are ephemeral and not network deployments.

Receipts are joined to events by execution chain, contract, receipt hash and
transaction hash. Events are queried in chunks of at most 5,000 blocks from the
manifest's deployment block. Local-only records are explicitly UNVERIFIED.
Invalid or obsolete dry demo files (including zero-contract records) are excluded
with a warning, independently of valid files.

## Market evidence

The mainnet evidence collector is reused directly from core, including response
validation, block-pinned QuoterV2 calls, DEX age, MEXC/Gate prices and APRO age.
The size grid comes from the policy presets. No overlapping polls: the next poll
starts 30 seconds after completion. CEX errors display **CEX unavailable**;
prices/costs are never filled with constants. APRO is off-chain evidence only;
the vault oracle is disabled. Testnet and Anvil prices are labelled unreal.

For a development-only CEX proxy:

```sh
ENABLE_CEX_PROXY=true VITE_CEX_PROXY=true pnpm dev
```

Both flags must be set. Vite proxies only the documented public MEXC/Gate
endpoints. Production needs working API CORS or an explicitly configured hosting
proxy; this development proxy is not shipped as a production backend.

## Verify

Paste a transaction hash. The verifier uses a matching locally served keeper
receipt, or paste its JSON into the optional receipt box. Verification calls the
shared verifier core against the selected chain's read-only RPC and shows
PASS/FAIL per completed check; verifier checks stop at the first failure.

**Replay recorded Anvil trade** uses the genuine T6 transaction/RPC recording,
explicitly labelled offline, local Anvil, and prices not real. It is not a live
network verification. Recording provenance and synthetic market-input limits
are documented in `packages/verifier/test/fixtures/README.md`.

## Ledger owner panel

`VITE_ENABLE_OWNER=false pnpm dev` (or set the variable at build time) hides the
owner panel for NO-GO. Ledger owner actions accept **chain 133 only**, even though
other project components may write to Anvil. The panel becomes available only
once a verified vault manifest and live mandate can be read.

1. Edit the mandate; token amounts use decimals read from the token contracts.
2. Build a `setMandate` or `revoke` review. The panel shows current/proposed values,
   exact calldata, its keccak256 hash, destination and chain. Edits invalidate it.
3. In a WebHID browser on HTTPS/localhost, connect the Ledger Ethereum app and
   verify the displayed owner address on-device. The path is `44'/60'/0'/0/n`.
4. Inspect the blind-signing warning and compare the calldata hash with the device.
   If the device cannot show the data hash, reject. Confirm only on testnet 133.

The adapter checks RPC chain repeatedly, verifies the live vault owner and Ledger
address, simulates gas, signs an EIP-155 legacy transaction, verifies the recovered
signer and broadcasts only on 133. It disconnects on both success and failure.
Only `setMandate` and `revoke` are accepted. It never uses a private or agent key.
Natural-language diffs call core's deterministic `nlToParamDiff`; they cannot
apply changes or send transactions. Widening beyond the mandate is refused.

**UNVERIFIED:** real-device signing, data-hash display and actual Ledger support
for chain 133. A human must test these before GO. Mocked SDK and MockSigner tests
are not evidence of real hardware compatibility.


## T8 read-only Vercel demo

Hosted demo: https://nalvis-hsk-demo.vercel.app (recorded local Anvil; prices not real).

Import the repository into Vercel with **repository root** as Root Directory.
The root `vercel.json` installs the pnpm workspace, builds the dashboard with
`VITE_ENABLE_OWNER=false VITE_DEMO_MODE=true`, and publishes `apps/dashboard/dist`.
Use Node 22 in Vercel project settings. No secrets or private keys are needed.
From a signed-in Vercel CLI at the repository root: `vercel` for a preview, then
`vercel --prod` for production. Save the actual returned URL in the PR. This
configuration alone does not prove that a hosted deployment exists.

Hash routes (`/#/mandate`, `/#/evidence`, `/#/receipts`, `/#/verify`, `/#/desk`)
work on static hosting without server rewrites. Demo mode ships the four genuine
T8 v2 Anvil recordings and replays their recorded RPC responses. It never presents
them as live prices. Turn it off to attempt browser read-only market calls; CEX
CORS/RPC availability may vary and failures are displayed explicitly. The
optional local CEX proxy is development-only and is not a hosted server.

The v2 demo records chain-based expiry and deterministic **±σ worst-case stress**
at two endpoints, using frozen October 27 volatility. It does not simulate random
price paths or claim Monte Carlo results. T6 legacy fixtures are retained for
compatibility tests and accepted only by their pinned receipt hashes.
