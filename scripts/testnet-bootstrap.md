# Human testnet bootstrap (chain 133 only)

Run locally from the repository root after reviewing this commit. Codex never
receives these keys or broadcasts to 133/177. Testnet prices are fake. There is
no proven edge. Requirements: Foundry, git, Python 3, jq, a Ledger with its Ethereum
app, and enough faucet test HSK for wrapping and gas. All amounts below are raw
units; **both WHSK and test-USDT have 18 decimals on 133** (mainnet USDT has 6).

## 1. Configure the approved local signers

```bash
set -euo pipefail
set +x
# Import only the already-approved accounts. Type secrets into Foundry's local
# interactive prompts; never put them in .env, shell variables, files, or chat.
cast wallet list | grep -q '^nalvis-deployer' || cast wallet import nalvis-deployer --interactive
cast wallet list | grep -q '^nalvis-agent' || cast wallet import nalvis-agent --interactive
set -a
source contracts/.env
set +a
test "$(cast wallet address --account nalvis-deployer)" = "$DEPLOYER_ADDRESS"
test "$(cast wallet address --account nalvis-agent)" = "$AGENT_ADDRESS"
test "${OWNER_ADDRESS,,}" != "${DEPLOYER_ADDRESS,,}"
test "${OWNER_ADDRESS,,}" != "${AGENT_ADDRESS,,}"
test "${DEPLOYER_ADDRESS,,}" != "${AGENT_ADDRESS,,}"
assert_testnet() { test "$(cast chain-id --rpc-url "$HSK_TESTNET_RPC")" = 133; }
send133() { assert_testnet; cast send --rpc-url "$HSK_TESTNET_RPC" "$@"; }
assert_testnet
cast wallet list
cast balance "$DEPLOYER_ADDRESS" --rpc-url "$HSK_TESTNET_RPC"
```

If an approved account is missing, stop and have its owner import that existing
account locally; do not generate a replacement. The configured temporary initial
owner is `0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927`; Nishanth's Ledger is the
intended final owner and its address must be provided and verified separately.
The temporary owner needs test HSK for two nominations; the final Ledger needs
test HSK for two acceptances and the later mandate transaction.
Claim test HSK for deployer and agent at
https://faucet.hsk.xyz/faucet (redirects to the HSK Chain faucet); it currently
offers 1 HSK per address every 24 hours. The agent needs gas only; the deployer
funds the vault. Never use real funds. Stop if the faucet or any preflight fails.

Both contracts support two-step ownership handover. After deployment, the
temporary owner must nominate the verified Ledger on each contract, and the
Ledger must accept on each contract. This is four separate transactions total;
verify each `owner()` and zero `pendingOwner()` afterward. Vault mandate/agent
configuration remains a separate owner action and is not changed by transfer.

## 2. Wrap test HSK and acquire test-USDT

These addresses come only from docs/ADDRESSES.md / contracts/script/Addresses.sol.
The quote is an `eth_call`; SwapRouter02's tuple has **no deadline**. Its
`multicall(uint256,bytes[])` wrapper supplies the bootstrap swap's deadline.

```bash
export WHSK=0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6
export USDT=0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F
export SWAP_ROUTER=0xa6914E66690c6794244B5f66a09eAEbf66254237
export QUOTER=0x73820d9eE5Bf1BfcD429580320FC7A374E8fa1cC
export POOL=0xc076FB478b77633736738579c7f48D2539604a50
assert_testnet
test "$(cast call "$WHSK" 'decimals()(uint8)' --rpc-url "$HSK_TESTNET_RPC")" = 18
test "$(cast call "$USDT" 'decimals()(uint8)' --rpc-url "$HSK_TESTNET_RPC")" = 18
send133 --account nalvis-deployer "$WHSK" 'deposit()' --value 0.5ether
export SWAP_IN=200000000000000000
QUOTE=$(cast call "$QUOTER" \
  'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' \
  "($WHSK,$USDT,$SWAP_IN,3000,0)" --rpc-url "$HSK_TESTNET_RPC" | sed -n '1s/ .*//p')
export MIN_OUT=$(python3 -c 'import sys; print(int(sys.argv[1])*99//100)' "$QUOTE")
python3 -c 'import sys; assert int(sys.argv[1]) > 0' "$MIN_OUT"
send133 --account nalvis-deployer "$WHSK" 'approve(address,uint256)' "$SWAP_ROUTER" "$SWAP_IN"
DEADLINE=$(( $(date +%s) + 300 ))
SWAP_DATA=$(cast calldata 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))' \
  "($WHSK,$USDT,3000,$DEPLOYER_ADDRESS,$SWAP_IN,$MIN_OUT,0)")
send133 --account nalvis-deployer "$SWAP_ROUTER" 'multicall(uint256,bytes[])(bytes[])' "$DEADLINE" "[$SWAP_DATA]"
send133 --account nalvis-deployer "$WHSK" 'approve(address,uint256)' "$SWAP_ROUTER" 0
cast call "$USDT" 'balanceOf(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$HSK_TESTNET_RPC"
```

This is a mechanics exercise; the faucet and **live testnet** acquisition procedure
remain UNVERIFIED. Quote/liquidity may change: rebuild a fresh quote on failure;
never use zero minOut. If the swap fails, revoke its outstanding approval with the
last `approve(...,0)` command before retrying.

## 3. Deploy and fund (human broadcast)

```bash
export DEPLOY_COMMIT=$(git rev-parse HEAD)
export TWAP_WINDOW_SEC=600
assert_testnet
cd contracts
forge script script/Deploy.s.sol --rpc-url "$HSK_TESTNET_RPC" --broadcast \
  --account nalvis-deployer --sender "$DEPLOYER_ADDRESS" -vvv
cd ..
# Set these from the script's output only after independently verifying both
# successful mined deployment receipts, chain ID 133, and deployed bytecode.
read -r -p 'Verified vault address: ' VAULT_ADDRESS
read -r -p 'Verified router address: ' PROOF_ROUTER_ADDRESS
cast code "$VAULT_ADDRESS" --rpc-url "$HSK_TESTNET_RPC"
cast call "$VAULT_ADDRESS" 'owner()(address)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$PROOF_ROUTER_ADDRESS" 'owner()(address)' --rpc-url "$HSK_TESTNET_RPC"
# Verify both deployment receipts, then have the temporary owner nominate the
# verified Ledger address on each contract. Ledger acceptance follows in §4.
send133 --account nalvis-deployer "$WHSK" 'transfer(address,uint256)(bool)' "$VAULT_ADDRESS" 100000000000000000
send133 --account nalvis-deployer "$USDT" 'transfer(address,uint256)(bool)' "$VAULT_ADDRESS" 5000000000000000000
```

The deployment script does not write a manifest: simulation output is not proof
of deployment and must not overwrite confirmed records. Verify both transactions
in `contracts/broadcast/Deploy.s.sol/133/run-latest.json`, their successful
receipts, code and owners. Only then update `contracts/deployments/133.json` and
add the deployment rows to `docs/ADDRESSES.md`, using mined receipt block numbers
and transaction hashes. The deployer has no privileges after deployment. Do not
add Anvil addresses to that registry.

## 4. Transfer ownership and configure the mandate

**UNVERIFIED on chain 133:** `cast send --ledger` and dashboard signing. Enable
**blind signing** in the Ledger Ethereum app; chain 133 has no clear-signing
descriptor. Review destination, chain, agent, expiry and every cap before signing.
The dashboard is a later milestone; the commands below are manual alternatives.
The temporary owner must have a locally available encrypted Foundry signer.
Resolve its alias locally and verify that it matches `OWNER_ADDRESS`; never put
the key or password in `.env`, shell history, or chat. If no matching secure
signer is available, stop before deployment because ownership cannot be handed
over.

```bash
export TEMP_OWNER_ACCOUNT=REPLACE_WITH_ENCRYPTED_FOUNDRY_ACCOUNT_ALIAS
test "$(cast wallet address --account "$TEMP_OWNER_ACCOUNT" | tr '[:upper:]' '[:lower:]')" = \
  "${OWNER_ADDRESS,,}"
export LEDGER_ADDRESS=REPLACE_WITH_VERIFIED_LEDGER_ADDRESS
test "${LEDGER_ADDRESS,,}" != "${DEPLOYER_ADDRESS,,}"
test "${LEDGER_ADDRESS,,}" != "${AGENT_ADDRESS,,}"
send133 "$VAULT_ADDRESS" 'transferOwnership(address)' "$LEDGER_ADDRESS" \
  --account "$TEMP_OWNER_ACCOUNT"
send133 "$PROOF_ROUTER_ADDRESS" 'transferOwnership(address)' "$LEDGER_ADDRESS" \
  --account "$TEMP_OWNER_ACCOUNT"
cast call "$VAULT_ADDRESS" 'pendingOwner()(address)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$PROOF_ROUTER_ADDRESS" 'pendingOwner()(address)' --rpc-url "$HSK_TESTNET_RPC"
```

Then Nishanth must accept from the Ledger on each contract, using verified
chain-133 signing. Verify both `owner()` values equal the Ledger and both
`pendingOwner()` values are zero before continuing:

```bash
send133 "$VAULT_ADDRESS" --data "$(cast calldata 'acceptOwnership()')" \
  --ledger --sender "$LEDGER_ADDRESS" --mnemonic-derivation-path "m/44'/60'/0'/0/0"
send133 "$PROOF_ROUTER_ADDRESS" --data "$(cast calldata 'acceptOwnership()')" \
  --ledger --sender "$LEDGER_ADDRESS" --mnemonic-derivation-path "m/44'/60'/0'/0/0"
cast call "$VAULT_ADDRESS" 'owner()(address)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$PROOF_ROUTER_ADDRESS" 'owner()(address)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$VAULT_ADDRESS" 'pendingOwner()(address)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$PROOF_ROUTER_ADDRESS" 'pendingOwner()(address)' --rpc-url "$HSK_TESTNET_RPC"
```

Only after verifying handover should the Ledger sign the mandate calldata below.

```bash
mkdir -p work
cd contracts
forge script script/MandateCalldata.s.sol --rpc-url "$HSK_TESTNET_RPC" -vv
forge script script/MandateCalldata.s.sol --rpc-url "$HSK_TESTNET_RPC" --json > ../work/mandate.json
cd ..
export SET_DATA=$(jq -er '.returns.setData.value' work/mandate.json)
export REVOKE_DATA=$(jq -er '.returns.revokeData.value' work/mandate.json)
# Rebuild if the printed expiry is stale. Confirm the destination is the vault.
send133 "$VAULT_ADDRESS" --data "$SET_DATA" --ledger --sender "$OWNER_ADDRESS" \
  --mnemonic-derivation-path "m/44'/60'/0'/0/0"
cast call "$VAULT_ADDRESS" \
  'mandate()(address,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint256,bytes32)' \
  --rpc-url "$HSK_TESTNET_RPC"
```

Default: 2 WHSK/trade, 100 test-USDT/trade, 500 test-USDT per UTC calendar day,
80% exposure cap (strict exposure reduction allowed), 100 bps slippage,
2000 bps (20%) max drawdown from high-water mark before circuit breaker triggers,
300-second cooldown, expiry at the RPC block timestamp + 7 days. Missing
`policy/default.json` prints a WARNING and uses zero policyHash. If present, it
must contain canonical sorted-key JSON with no whitespace; the helper hashes its
exact file bytes. Review the same bytes/hash before signing. No APRO exists on
133: oracle, band and age are all zero.

Mandate field reference (T9 guardrails):
- `maxDrawdownBps`: set via `MAX_DRAWDOWN_BPS` env var (default 2000 = 20%).
  Agent trades halt if total vault value drops > `maxDrawdownBps` bps below its
  high-water mark; owner must re-sign a mandate to reset.
- `maxSlippageBps`: hard-capped at 100 bps by contract constant; cannot be raised.
- `minIntervalSec`: minimum seconds between agent trades (default 300).
- `maxDailyInB`: rolling UTC calendar-day notional cap in tokenB units.

## 5. One agent trade, then verify

```bash
cd contracts
forge script script/TradeCalldata.s.sol --rpc-url "$HSK_TESTNET_RPC" -vv
forge script script/TradeCalldata.s.sol --rpc-url "$HSK_TESTNET_RPC" --json > ../work/trade.json
cd ..
TRADE_DATA=$(jq -er '.returns.tradeData.value' work/trade.json)
send133 --account nalvis-agent "$VAULT_ADDRESS" --data "$TRADE_DATA" --json > work/trade-tx.json
TX_HASH=$(jq -er '.transactionHash' work/trade-tx.json)
cast receipt "$TX_HASH" --rpc-url "$HSK_TESTNET_RPC" --json > work/trade-receipt.json
cast call "$VAULT_ADDRESS" 'seq()(uint64)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$VAULT_ADDRESS" 'head()(bytes32)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$VAULT_ADDRESS" 'highWaterMark()(uint256)' --rpc-url "$HSK_TESTNET_RPC"
cast call "$WHSK" 'allowance(address,address)(uint256)' "$VAULT_ADDRESS" "$SWAP_ROUTER" \
  --rpc-url "$HSK_TESTNET_RPC"
RECEIPT_DATA=$(jq -er --arg vault "${VAULT_ADDRESS,,}" '
  .logs[] | select((.address | ascii_downcase) == $vault) | .data' work/trade-receipt.json)
cast decode-event --sig 'Receipt(uint64 indexed seq,bytes32 indexed receiptHash,bytes32 prevHead,bytes32 policyHash,uint8 kind,address tokenIn,uint256 amountIn,uint256 amountOut,uint256 minOut,uint256 refOut)' \
  "$RECEIPT_DATA"
```

Use `cast receipt` logs (or the explorer) to decode the vault's `Receipt`: verify
amountOut >= minOut, sequence/head and policyHash; allowance must read zero. The
first-trade helper sells 0.01 WHSK using the current vault TWAP and the default
1% floor, nonce/head, and a five-minute deadline. It is a manual bootstrap helper,
not evidence-driven strategy execution. If TWAP history is unavailable, price
moves, cooldown applies or liquidity cannot fill above that floor, STOP/rebuild
later; do not weaken the checks. Testnet results are not real P&L.

Emergency owner revoke (same UNVERIFIED Ledger path):

```bash
send133 "$VAULT_ADDRESS" --data "$REVOKE_DATA" --ledger --sender "$OWNER_ADDRESS" \
  --mnemonic-derivation-path "m/44'/60'/0'/0/0"
```

## GO / NO-GO — 29 October 2026, 23:59 IST (docs/PLAN.md)

- [ ] Ledger signed and broadcast `setMandate` successfully on **133**; save tx hash.
- [ ] Agent `trade()` succeeded on **133**, real testnet pool fill, Receipt emitted,
      amountOut >= minOut, allowance zero; save tx hash and decoded receipt.
- [ ] Roles are distinct; deployed owners are the Ledger; no deployer privileges.
- [ ] Record the decision and transaction evidence under docs/PLAN.md Decision log.

**GO** only with both Ledger mandate and vault trade. Fork tests do not establish
GO. **NO-GO:** ship ProofTrade only, leave vault code unadvertised, hide owner UI;
keeper calls ProofTradeRouter `commitAndSwap`/`commitHold` from its testnet wallet.
M4–M8 remain unchanged. Faucet, Ledger support and live broadcasts require the
human to verify them; they are not established by Codex's local tests.
