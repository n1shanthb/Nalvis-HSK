# Genuine fork execution recordings

Generated on 28 October 2026 by the T5 Anvil integration test, with T6's committed
replay snapshot extension. Base: T5 main commit `e1033a1`; keeper replay inputs
added in `08cea51`. Foundry forge/anvil 1.8.6, Solidity 0.8.24; fork of HashKey
mainnet 177 at block **29413000**, execution chain **31337**.

The integration deployed EdgewiseVault and ProofTradeRouter using distinct
public Anvil owner, agent and deployer accounts, funded the vault by local-only
pool impersonation, and called `keeper run --once --exec anvil` for TRADE, WAIT,
RESIZE and REJECT. These transactions mined successfully through the real fork
contracts. Markets are labelled synthetic DEMO inputs; execution quotes and
fills are real local-fork calls. No remote broadcast occurred.

`receipts/` contains the keeper JSON written by those transactions, including
settlement. `chain.json` contains the unmodified RPC transaction receipts/logs
and transactions plus historical contract heads and token/fee configuration
queried immediately after mining. It is a recorded RPC response bundle, not a
live RPC or a cryptographic proof of an external chain. Seq starts at 0; each
successive prevHead matches the preceding receipt head. Tests decode the raw logs
instead of trusting `settlement.log`.

The T5 fork test passed during capture and again in the full workspace tests;
it now also verifies every receipt and tx via the live local RPC before cleanup.
The genuine fork addresses here are ephemeral fixtures, not deployments for
users or testnet broadcasts. Transactions must not be looked up on mainnet or
testnet explorers. Regeneration uses the opt-in recording hook documented in
`packages/verifier/README.md`; timestamps, hashes and calldata will change.
