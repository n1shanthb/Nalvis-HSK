# T8 v2 local fork recording

Recorded by `packages/keeper/test/anvil.integration.test.ts` with
`VERIFIER_FIXTURE_DIR` pointing to this directory. These are actual mined local
Anvil transactions on a fork of mainnet block 29413000, chain 31337. Market
scenarios are synthetic and clearly labelled; prices are not real. No remote
broadcast occurred. Every receipt passed live RPC verification before capture.

All four receipts use version 2, decisionTime from the execution block, matching
validUntil in evidence/decision/transaction, frozen October 27 volatility input,
and an explicit sigma-worst-case stress source. TRADE and RESIZE record the
computed two-endpoint result. WAIT/REJECT record that no executable candidate
reached the cost stress. `chain.json` is an offline RPC response bundle, not
independent proof of an external chain. T6 recordings are retained unchanged in
the parent fixture directory and verified only against their pinned hashes.
