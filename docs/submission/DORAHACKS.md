# Nalvis — hardware-governed DeFi automation on HashKey Chain

**Keep ownership on a Ledger. Give an agent boundaries, not an unrestricted wallet.**

[Live app](https://nalvis-hsk-delta.vercel.app/) · [GitHub](https://github.com/n1shanthb/Nalvis-HSK) · [Live mainnet agent](https://nalvis-hsk-delta.vercel.app/#/agent)

## The problem

Hardware wallets protect ownership keys, but unattended DeFi usually relies on
a hot wallet with broad spending power. Treasury owners and long-term holders
face a choice: manually approve every market response, or give a bot more
authority than it needs.

Nalvis separates ownership from trading authority. It targets the control and
auditability needs of institutional-style treasury workflows: retain hardware
ownership, allocate a bounded trading balance and let an agent pursue
opportunities on HashKey Chain. Helping holders manage risk and seek asset
growth is the objective, not a guarantee of protection or returns.

## How it works

1. **Authorize:** the owner signs a mandate with their Ledger, binding agent,
   expiry, policy hash, trade/daily limits, exposure, slippage, drawdown and
   minimum interval.
2. **Observe:** an always-on keeper gathers executable HSKSwap WHSK/USDT quotes
   and market evidence, with fresh MEXC/Gate context. The active policy excludes
   stale APRO rather than treating it as fresh data.
3. **Decide:** a Strategist proposes an action; a Fitter negotiates a compliant
   proposal. Deterministic checks, simulation and contract enforcement govern
   execution. The LLM does not sign transactions or construct calldata.
4. **Execute and prove:** an authorized trade swaps and records its receipt
   atomically. Selected hold/reject outcomes can be anchored without a swap.
   Journals and evidence support independent verification.
5. **Retain control:** the Ledger owner can pause or revoke authority and
   withdraw. Autonomous trades within the mandate do not need another hardware
   signature each time.

The ownership key stays on hardware. **Trading funds live in a smart-contract
vault, not offline cold storage.** A separate hot agent key cannot act as the
owner. This bounds authority; it does not eliminate contract or market risk.

## Key features

- Hardware-governed mandate and owner kill switches.
- AI Strategist/Fitter with deterministic final execution gates.
- Live mainnet decisions, strategy notes, timestamps, watches and market charts.
- Hash-chained on-chain receipt commitments and independent verification.
- Nalvis Copilot: natural-language requests and a fresh sell review with
  balance, quoted/minimum output and estimated costs. One Ledger-authorized
  15-minute SELL session permits separately confirmed, mandate-compliant sells
  without another hardware prompt per order. Public viewers cannot trade.
- Persistent OCI runtime, Vercel interface and Redis limits/signed-order queue.
- Honest unavailable states: no invented P&L, and WAIT is valid when the market
  does not justify trading.

## Mainnet deployment · HashKey Chain 177

**EdgewiseVault:** [0x8E5043edCD2710503C351b77f27958F531E0C521](https://hsk.blockscout.com/address/0x8E5043edCD2710503C351b77f27958F531E0C521)

**ProofTradeRouter:** [0x73934f4E2f51bD6191e32B1BbC2E59cA6527b88a](https://hsk.blockscout.com/address/0x73934f4E2f51bD6191e32B1BbC2E59cA6527b88a)

Both mainnet sources have Sourcify exact-match verification recorded in the
repository. The live Ledger-governed path uses EdgewiseVault. ProofTradeRouter
is a separate fallback product, not the vault's HSKSwap router.

- [Vault deployment transaction](https://hsk.blockscout.com/tx/0x6de18ac3fd8c23b5af438510007a72d0ea2490d76699ab2f5086cbb55aee7e00)
- [Router deployment transaction](https://hsk.blockscout.com/tx/0xa1bda1f55e674d1ed07e6e97949b4b0fae2e4d7f405b1935960c6f0d79a81eb9)
- [Ledger-authorized mandate update](https://hsk.blockscout.com/tx/0x906f856f7af4fe56a53fbc5d352e3274daf963593e0f3102d4628faf3367f59c)
- [Mainnet WAIT receipt anchor](https://hsk.blockscout.com/tx/0xad4ede6b975f9178cdbfa5e6a5501603c625238094d76ac894c8bacc0f36c592)
- [Inspect that receipt in Nalvis](https://nalvis-hsk-delta.vercel.app/#/verify?tx=0xad4ede6b975f9178cdbfa5e6a5501603c625238094d76ac894c8bacc0f36c592)

Receipts are vault events, not a separate token address. The linked WAIT
transaction is a successful **`commitHold`, not a swap**.

## Testnet deployment · HSK Chain 133

- [EdgewiseVault: 0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc](https://testnet-explorer.hskchain.net/address/0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc)
- [ProofTradeRouter: 0xC5Fa869C8423B41696886A7761ec31b3846f4e4B](https://testnet-explorer.hskchain.net/address/0xC5Fa869C8423B41696886A7761ec31b3846f4e4B)

Testnet prices are not real; no testnet trade receipt is claimed.

## What judges can verify today

Open the app and choose **View Nishanth's mainnet agent**. No Ledger is needed
to inspect its published activity. Read the last decision, inspect the mandate
and follow the receipt to Blockscout and Verify.

At the **2 November 2026, 16:33 IST** check, the keeper was online with a matching
policy hash and four receipt commitments. The vault held 5 USDT and 0 WHSK;
observed live activity was WAIT, not successful swaps. Local Anvil tests exercise
swaps, exact confirmation signatures, independent verification and interrupted
settlement recovery. Those tests are not mainnet trade evidence.

The current mandate expires **3 November 2026, 10:29:23 IST** unless replaced
by the owner. Live status can change; timestamps and expiry remain visible.

## Stack and track

Solidity / Foundry, TypeScript / viem / zod, React / Vite, Ledger WebHID,
OpenRouter, OCI, Vercel and Upstash Redis. Built for **Track 1: AI Agent Trading**,
using HashKey Chain and HSKSwap. HSP payments are not integrated.

## Honest scope

Unaudited prototype with no proven trading edge or sustained profitability.
P&L remains unavailable without verified cost basis.
Ledger signing is currently blind signing. This targets treasury control needs;
it is not an institutional production-readiness or customer-adoption claim.

**Our contribution: security-conscious delegation plus inspectable automation,
without giving the AI unrestricted custody.**
