# T7 verification

Base: latest main `a0038c3786b790e7f48394dc37f7e39fa3d58738` (T6 merged).
Implementation is on `task/t7-dashboard`, committed and pushed per logical unit.

Verified on 28 October 2026:

- `pnpm --filter dashboard build`: PASS (TypeScript plus Vite production build).
- `pnpm test`: PASS — 177 passed, 2 skipped. Dashboard: 31 passed, covering
  slippage clamping, decimals, owner/agent separation, expiry/precision rejection,
  chain 177/31337 refusal, NO-GO hiding, natural-language refusal, revoke calldata,
  mocked DMK WebHID operations and cleanup, MockSigner signing and recovered-owner
  broadcast, rejection/wrong owner/wrong signature/chain-switch failures,
  tampered genuine fixture FAIL, genuine fixture PASS, four-route jsdom smoke,
  mocked viem mandate reads, receipt validation and explorer isolation.
- `pnpm lint`: PASS (workspace ESLint and TypeScript no-emit check).
- `forge test -vv`: PASS — 107 passed, 1 skipped, including real mainnet and testnet
  fork swaps. Foundry 1.5.1 and solc 0.8.24 were installed under ignored `work/`.
- `bash scripts/check-rules.sh` and `git diff --check`: PASS.
- `pnpm --filter dashboard preview --host 127.0.0.1`: served the production build.
  Chromium/Playwright navigated all four routes with **zero page exceptions** and
  the genuine recorded Anvil trade verified PASS in-browser.

Skip details: the core live evidence test is opt-in (`RUN_NETWORK_TESTS` unset).
The keeper integration explicitly skipped on RPC preflight `HttpRequestError`;
Node's HTTP path in this environment did not reach the RPC through the proxy.
Foundry's RPC path worked, so its mainnet/testnet fork tests ran. The one skipped
Foundry test is the existing real-oracle staleness test: APRO reverts for a normal
contract caller, so the vault's on-chain oracle remains disabled.

Runtime: Node 24.19.0 / pnpm 9.15.9 in this environment; repository target remains
Node 22. Vite reports the large main/Ledger bundle warning. The owner module is
lazy-loaded. No packages were published, and no remote transaction was broadcast.

## Screenshots

Actual production preview captures, not generated mockups:

- [Mandate and unavailable deployment state](screenshots/t7-mandate.png)
- [Recorded Anvil verification PASS](screenshots/t7-verify.png)
- [Mobile verification](screenshots/t7-mobile.png)

The screenshot browser was restricted to the local preview; external requests
were aborted, so the captures make no live-market availability claim. The
verification screenshot is explicitly labelled offline replay of T6's genuine
RPC/transaction recording. Its market inputs are synthetic; execution was a real
local-fork transaction. No testnet fixture is linked to a remote explorer.

## UNVERIFIED / human follow-up

- Real Ledger hardware signing, data-hash display, rejection UX, and Ethereum app
  support on chain 133. Mocked SDK/MockSigner tests cannot establish hardware
  support. Human confirmation is required before the project's GO decision.
- No verified testnet vault/router deployment exists in `docs/ADDRESSES.md`.
  Mandate reads, on-chain receipt listing, and owner actions remain unavailable
  until the human supplies and documents a real deployment manifest.
- Browser CORS and end-to-end live-market availability depend on external APIs.
  The optional development CEX proxy is implemented; unavailable sources are
  displayed explicitly. Production proxy hosting is outside this task.
- No new live Anvil execution recording was generated in this task; the verifier
  demo uses the genuine, committed T6 recording with its existing provenance.
