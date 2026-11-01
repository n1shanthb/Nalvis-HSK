# Task 9 practice deployment status

**Status: DEPLOYMENT VERIFIED; mandate, funding, and execution scenarios remain pending.**
Deployment facts below are confirmed from chain-133 receipts and read-only state
calls. This is not a claim that the trading workflow is configured or complete.

Rechecked on 1 November 2026.

## Confirmed testnet configuration

| Item | Confirmed value |
|---|---|
| Network | HSK Testnet |
| Chain ID | `133` (read-only `eth_chainId` via `https://testnet.hsk.xyz`) |
| Source commit | `00f79c4ea5fcced27b3e33940a62ba56928f1b7e` |
| Initial temporary deployment owner | `0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927` |
| Current owner returned by both contracts | `0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927` |
| Final intended owner | Nishanth's Ledger address; not yet supplied or verified |
| Agent public address from local `.env` | `0x6845a4caCcEaCd6eE5407C9E217610c26964ba2a` |
| Vault mandate agent | Zero address; mandate has not been configured |
| Router policy hash | Zero |
| Deployer public address | `0xee9A370e88385E7f366E1e7c88D73F3a1691fEe1` (configured in local `.env`) |
| Configured owner / agent / deployer addresses distinct | Yes |
| Deployment block | `35175424` |
| Vault gas used | `3,531,069` |
| Router gas used | `901,698` |
| Deployer / token balances | Not included here; recheck live before funding or execution |
| `.env` Git protection | `contracts/.env` is ignored by `.gitignore` and is not tracked |

## Confirmed deployment receipts

Both transactions were mined on chain 133 in block `35175424`, each with
successful status (`0x1`). Their receipt block hash is
`0x8ef35ba9695648e91c213a3b9201fb397e4e6a0bf31775cf940389f0b2110e3d`.
Read-only `eth_getCode` calls returned 15,704 bytes for the vault and 3,680
bytes for the router.

| Contract | Address | Transaction hash | Gas used | Explorer |
|---|---|---|---:|---|
| EdgewiseVault | `0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc` | `0xcb7480c81476eb9eb76f4ef7eab8e872e3d5c94cde4b23173b1ca9ad247c6941` | 3,531,069 | [Contract](https://testnet-explorer.hskchain.net/address/0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc) |
| ProofTradeRouter | `0xC5Fa869C8423B41696886A7761ec31b3846f4e4B` | `0x24519a67fa5a3f4e050ce73249b0099503fcad08424b106ad8a9fed70cae031f` | 901,698 | [Contract](https://testnet-explorer.hskchain.net/address/0xC5Fa869C8423B41696886A7761ec31b3846f4e4B) |

Both `owner()` calls return the temporary owner address above, and both
`pendingOwner()` calls return zero. The vault constructor state was verified as
SwapRouter02 `0xa6914E66690c6794244B5f66a09eAEbf66254237`, pool
`0xc076FB478b77633736738579c7f48D2539604a50`, WHSK
`0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6`, test-USDT
`0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F`, fee 3000, TWAP 600 seconds,
and oracle zero. Router's immutable SwapRouter02 address was also verified.
See [`contracts/deployments/133.json`](../contracts/deployments/133.json) for
the confirmed manifest.

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

The deployment is now recorded in `contracts/deployments/133.json` from
confirmed receipts and read-only state. The vault mandate agent is zero and
the router policy hash is zero: deployment did not configure either.

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

Deployment is confirmed, but the mandate and funding are not ready; none of
these execution scenarios has an on-chain transaction or testnet receipt:

| Scenario | Testnet result |
|---|---|
| TRADE | Not executed — blocked before deployment and funding |
| RESIZE | Not executed — blocked before deployment and funding |
| WAIT | Not executed — mandate not configured |
| REJECT | Not executed — mandate not configured |
| PAUSE | Not executed — no owner transaction |
| REVOKE | Not executed — no owner transaction |

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
5. Deployment and receipt verification are complete. Configure the mandate with
   the intended agent, complete the separately approved Ledger ownership
   handover when its address is verified, fund the vault using verified test
   tokens, then execute and verify scenarios. Record only confirmed transaction
   data.
