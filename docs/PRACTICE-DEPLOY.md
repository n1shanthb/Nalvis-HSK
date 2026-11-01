# Task 9 practice deployment status

**Status: BLOCKED — no testnet deployment or owner-signed mandate is confirmed.**
This report distinguishes read-only testnet observations and local tests from
transactions. It does not claim that a simulated fork is a live deployment.

Rechecked on 1 November 2026.

## Confirmed testnet configuration

| Item | Confirmed value |
|---|---|
| Network | HSK Testnet |
| Chain ID | `133` (read-only `eth_chainId` via `https://testnet.hsk.xyz`) |
| `DEPLOY_COMMIT` | Set in the ignored local `contracts/.env` to the exact committed source revision before deployment |
| Initial temporary deployment owner | `0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927` |
| Initial owner Testnet balance | `0.1 HSK` (read-only RPC) |
| Final intended owner | Nishanth's Ledger address; not yet supplied or verified |
| Agent public address from local `.env` | `0x6845a4caCcEaCd6eE5407C9E217610c26964ba2a` |
| Owner / agent distinct | Yes; Ledger identity must still be independently confirmed with Nishanth |
| Deployer public address | `0xee9A370e88385E7f366E1e7c88D73F3a1691fEe1` (configured in local `.env`) |
| Foundry keystores | `nalvis-deployer` and `nalvis-agent` are present; user reports locally verifying their public addresses against `.env` |
| Configured owner / agent / deployer addresses distinct | Yes |
| Deployer / agent / temporary owner native test HSK | Each `0.1 HSK`, confirmed by read-only RPC |
| Owner / agent / deployer WHSK and test-USDT | All balances `0`; both tokens have 18 decimals |
| Constructor gas estimates | Vault `3,477,693`; router `810,261`; total `4,287,954` gas by `eth_estimateGas` |
| Current fee quote | `1.001 gwei` (`cast gas-price`); estimated constructor cost `0.004292241954 HSK`, `0.005365302443 HSK` with 25% margin |
| `.env` Git protection | `contracts/.env` is ignored by `.gitignore` and is not tracked |

The user reports both encrypted keystore aliases were unlocked locally and
their public addresses matched the configured roles; this session did not unlock
or sign with either account. The temporary initial owner is intentionally not
the Ledger address. Nishanth's final Ledger address has not been supplied or
independently verified. No private key, password, or signature was read or
reported. Gas estimates and fee quotes are read-only RPC estimates, not mined
measurements; fee quotes may change.

The deployment entrypoint reads all three configured roles, matches the CLI
sender to `DEPLOYER_ADDRESS`, assigns `OWNER_ADDRESS` as owner of both
contracts, and validates that the roles are nonzero and distinct. The agent is
not installed as an initial mandate in the constructor; the owner must later
call `setMandate`. The fork test now checks the temporary initial owner and
subsequent mandate agent.

**Ownership handover:** both contracts now support two-step ownership transfer.
The current owner nominates the Ledger with `transferOwnership(LEDGER_ADDRESS)`;
then the Ledger calls `acceptOwnership()`. Each contract has its own state and
requires its own nomination and acceptance, so the handover requires four
transactions total. The current owner may cancel a pending transfer by calling
`transferOwnership(address(0))`. The vault rejects nomination or acceptance by
its current mandate agent; ownership transfer does not change the mandate agent,
policy, balances, or immutable router/pool/token/oracle configuration. Before
mandate setup, verify both `owner()` values equal the Ledger and both
`pendingOwner()` values are zero.

The temporary owner must also have a locally available encrypted Foundry
signer whose public address matches `OWNER_ADDRESS`; without it, it cannot
nominate the Ledger. This signer must be distinct from the deployer and agent.

The Ledger must have sufficient native test HSK to pay for both acceptance
transactions and the later mandate transaction. The temporary owner needs gas
for both nominations.

## Verified external testnet contracts

Each address below returned non-empty bytecode from the testnet RPC. WHSK and
test-USDT both returned `decimals() = 18`. The primary pool returned
`token0 = test-USDT`, `token1 = WHSK`, and `fee = 3000`; the configured factory's
`getPool(test-USDT, WHSK, 3000)` returned the same pool.

| Contract | Address | Explorer |
|---|---|---|
| WHSK | `0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6` | [Address](https://testnet-explorer.hskchain.net/address/0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6) |
| test-USDT | `0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F` | [Address](https://testnet-explorer.hskchain.net/address/0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F) |
| SwapRouter02 | `0xa6914E66690c6794244B5f66a09eAEbf66254237` | [Address](https://testnet-explorer.hskchain.net/address/0xa6914E66690c6794244B5f66a09eAEbf66254237) |
| Primary WHSK/test-USDT pool (0.3%) | `0xc076FB478b77633736738579c7f48D2539604a50` | [Address](https://testnet-explorer.hskchain.net/address/0xc076FB478b77633736738579c7f48D2539604a50) |
| QuoterV2 | `0x73820d9eE5Bf1BfcD429580320FC7A374E8fa1cC` | [Address](https://testnet-explorer.hskchain.net/address/0x73820d9eE5Bf1BfcD429580320FC7A374E8fa1cC) |
| Factory | `0x2dC2c21D1049F786C535bF9d45F999dB5474f3A0` | [Address](https://testnet-explorer.hskchain.net/address/0x2dC2c21D1049F786C535bF9d45F999dB5474f3A0) |
| Position manager | `0x73dEc6bfa6751509b08480bd97f54b874E3b20e8` | [Address](https://testnet-explorer.hskchain.net/address/0x73dEc6bfa6751509b08480bd97f54b874E3b20e8) |
| Multicall | `0x47F625Ec29637445AA1570d7008Cf78692CdA096` | [Address](https://testnet-explorer.hskchain.net/address/0x47F625Ec29637445AA1570d7008Cf78692CdA096) |

## Deployment, mandate, and funding

No vault or ProofTradeRouter deployment is recorded in this checkout:
`contracts/deployments/` contains only `.gitkeep`, and there is no Foundry
broadcast artifact. A deployment elsewhere cannot be ruled out without its
address or transaction hash. No deployment transaction hash, receipt, mined
block, gas use, or contract address is available to report. Accordingly,
`contracts/deployments/133.json` was not created or populated with simulation
output.

The non-broadcast `MandateCalldata.s.sol` script loaded the local environment
and completed successfully. It produced calldata for the configured agent with
the helper's configured values: seven-day expiry, 2 WHSK per trade, 100
test-USDT per trade, 500 test-USDT daily turnover, 8000-bps exposure cap,
100-bps slippage cap, 2000-bps drawdown cap, and 300-second minimum interval.
The policy hash was `0xabeadf083e801ceaed5a290b5800095cd7243a791fe72419172017b32b048027`.
This was **calldata generation only**; no mandate transaction was signed or
confirmed on-chain.

Vault funding was not attempted. HashKey's documented faucet page currently
offers 1 test HSK per address every 24 hours; no claim was submitted or delivery
verified. The project runbook's wrap-and-swap flow is mechanically quoteable but
has not been executed. The deployer's current WHSK and test-USDT balances are
both zero. No funding transaction was sent.

A read-only QuoterV2 quote for `0.05 WHSK` returned `2.700923309916712964`
test-USDT, and the configured pool's 600-second `observe` call succeeded. This
shows the documented swap route currently quotes; it does not fund tokens or
prove that a later swap will execute. The runbook's `0.5 HSK` wrap amount exceeds
the deployer's current `0.1 HSK` balance. The temporary owner also has `0.1 HSK`;
Nishanth's final Ledger address is not yet known, so its balance and gas
readiness for ownership acceptance and mandate setup cannot be checked.

The optional mainnet-fork test `testRealOracleStaleFailsClosedWhenCallable`
skips its real-feed freshness assertion when APRO rejects the test contract
caller; mock-oracle tests still cover freshness and failure behavior. This is
expected for the current integration, not evidence of a Testnet oracle. No
verified APRO deployment exists on chain 133, so the 133 deployment intentionally
sets its immutable oracle to `address(0)`.

## Ledger signing readiness

Nishanth's physical Ledger address has not been supplied or independently
verified. The Ledger Ethereum app and chain-133 blind-signing setting remain
**not verified**. No Ledger was used and no prompt or transaction was initiated.

## Six requested scenarios

No testnet deployment is confirmed in this record, so none of these scenarios
has an on-chain transaction or testnet receipt:

| Scenario | Testnet result |
|---|---|
| TRADE | Not executed — blocked before deployment and funding |
| RESIZE | Not executed — blocked before deployment and funding |
| WAIT | Not executed — no live mandate/contract |
| REJECT | Not executed — no live mandate/contract |
| PAUSE | Not executed — no deployed vault or owner transaction |
| REVOKE | Not executed — no deployed vault or owner transaction |

The verifier CLI passed on one repository-provided **recorded local Anvil
fixture**. The output explicitly labels it “recorded RPC replay (offline; not
live chain proof)”; it is not one of the requested testnet receipts. No six
testnet receipt files were generated, so there were no testnet receipts to
verify.

## Local build and test results

| Check | Result |
|---|---|
| `forge build` | Passed |
| `forge test -vv` | 150 passed, 0 failed, 1 skipped across 12 suites; includes unit, fork, fuzz, and invariant tests |
| `forge test --match-path 'test/fork/DeployTestnetFork.t.sol' -vv` | 11 passed, 0 failed, 0 skipped; local Testnet fork only, test-only `deal()` funding, no broadcast |
| `pnpm -r build` | Passed; Vite reported a large-chunk advisory |
| `pnpm lint` | Passed |
| `pnpm -r exec vitest run --hookTimeout 60000 --testTimeout 30000 --maxWorkers=1` | 177 passed, 0 failed, 2 skipped; optional evidence and Anvil integrations skipped without their RPCs |
| Verifier CLI on recorded fixture | Passed; offline local fixture only |

The default `pnpm test` command was attempted twice; the verifier CLI test
`beforeAll` exceeded Vitest's default 20-second hook timeout under the full
workspace run. Running the workspace suite with `--hookTimeout 60000` passed,
and the verifier's own suite passed 40/40 with that timeout.

The deployment tests now cover signer mismatch, distinct roles, local dry-run
allowance, and rejection of broadcast/resume contexts on chain 31337, while
allowing those contexts on chain 133. The focused Testnet fork suite passes
11/11. No signing or broadcast was performed.

## Exact blockers / next actions

1. Have Nishanth supply and independently verify the final Ledger address. After
   deployment, the temporary owner nominates that address on both contracts;
   the Ledger accepts on each contract in separate transactions. Verify both
   on-chain owners and pending-owner values before configuring the mandate.
2. Deployer native test HSK covers the current constructor gas estimate, but
   not the runbook's 0.5 HSK wrap amount; all WHSK and test-USDT balances are
   zero. The temporary owner has 0.1 HSK, while the final Ledger balance is
   unknown. Recheck balances and obtain sufficient test HSK before the
   human-approved workflow.
3. The official faucet currently offers 1 HSK per address every 24 hours, but
   successful delivery has not been verified. Confirm the claim and transaction
   receipt locally; do not treat the page's offer as proof of funding.
4. Have Nishanth connect the Ledger, open the Ethereum app, verify chain-133
   blind-signing support, and review transaction details locally before signing.
   This session did not interact with the Ledger.
5. First establish whether a prior deployment exists. Then deploy only on chain
   133 if needed, verify mined receipts and bytecode, configure the mandate, fund
   the vault, execute scenarios, and write the deployment manifest from confirmed
   transaction data only.
