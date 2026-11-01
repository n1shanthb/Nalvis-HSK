#!/usr/bin/env bash
set +x
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:---dry-run}
[[ $# -le 1 && ( $mode == --dry-run || $mode == --execute ) ]] || { echo 'Usage: testnet-setup.sh --dry-run|--execute' >&2; exit 1; }
: "${HSK_TESTNET_RPC:?HSK_TESTNET_RPC required}"
command -v cast >/dev/null
command -v jq >/dev/null
mkdir -p work
assert133() { [[ $(cast chain-id --rpc-url "$HSK_TESTNET_RPC") == 133 ]] || { echo 'STOP: expected chain 133' >&2; exit 1; }; }
assert133
plan() { node packages/keeper/dist/keeper/src/testnet-plan.js "$@" > work/testnet-plan.json; }
summary() {
  jq -r '"Execution price: \(.execPrice) test USDT/WHSK", "Wrap raw: \(.wrap); swap raw WHSK: \(.swapIn)", "Vault top-ups raw: A=\(.vaultNeedA), B=\(.vaultNeedB)", (.mandate|to_entries[]|"\(.key) raw=\(.value)")' work/testnet-plan.json
  jq -r '.human|to_entries[]|"\(.key): \(.value)"' work/testnet-plan.json
  echo 'Mainnet prices/evidence are real. Execution is a testnet sandbox pool with its own price; no proven edge.'
}
if [[ $mode == --dry-run ]]; then plan; summary; echo 'DRY RUN: deploy -> acquire/fund -> generate policy -> build calldata -> owner signs Ledger -> start agent -> verify anchor -> register addresses'; exit 0; fi
: "${TESTNET_DEPLOYER_KEY:?TESTNET_DEPLOYER_KEY required locally only}"
: "${AGENT_ADDRESS:?AGENT_ADDRESS required (public)}"
: "${OWNER_ADDRESS:?OWNER_ADDRESS required (Ledger public address)}"
: "${STRATEGIST_MODEL:?STRATEGIST_MODEL required}"
: "${FITTER_MODEL:?FITTER_MODEL required}"
export DEPLOYER_ADDRESS
DEPLOYER_ADDRESS=$(cast wallet address --private-key "$TESTNET_DEPLOYER_KEY")
[[ ${DEPLOYER_ADDRESS,,} != "${AGENT_ADDRESS,,}" && ${OWNER_ADDRESS,,} != "${AGENT_ADDRESS,,}" && ${OWNER_ADDRESS,,} != "${DEPLOYER_ADDRESS,,}" ]] || { echo 'STOP: three distinct roles required' >&2; exit 1; }
balance() { cast balance "$1" --rpc-url "$HSK_TESTNET_RPC"; }
python3 - "$(balance "$DEPLOYER_ADDRESS")" "$(balance "$AGENT_ADDRESS")" <<'PY'
import sys
if int(sys.argv[1]) < 3*10**18 or int(sys.argv[2]) < 5*10**17:
    sys.exit('STOP: faucet UNVERIFIED. Fund deployer to >=3 test HSK and agent to >=0.5 test HSK, then rerun.')
PY
send133() {
  assert133
  cast send --rpc-url "$HSK_TESTNET_RPC" --private-key "$TESTNET_DEPLOYER_KEY" --json "$@" > work/setup-tx.json
  jq -er 'select(.status=="0x1" or .status==1) | .transactionHash' work/setup-tx.json
}
if [[ ! -f contracts/deployments/133.json ]]; then
  export DEPLOY_COMMIT
  DEPLOY_COMMIT=$(git rev-parse HEAD)
  assert133
  (cd contracts && forge script script/Deploy.s.sol --rpc-url "$HSK_TESTNET_RPC" --broadcast --private-key "$TESTNET_DEPLOYER_KEY")
  jq -er '.transactions[].hash' contracts/broadcast/Deploy.s.sol/133/run-latest.json
fi
export VAULT_ADDRESS
VAULT_ADDRESS=$(jq -er '.vault' contracts/deployments/133.json)
ROUTER_ADDRESS=$(jq -er '.router' contracts/deployments/133.json)
for address in "$VAULT_ADDRESS" "$ROUTER_ADDRESS"; do
  [[ $(cast code "$address" --rpc-url "$HSK_TESTNET_RPC") != 0x ]] || { echo 'STOP: manifest code missing; verify deployment receipts' >&2; exit 1; }
  chain_owner=$(cast call "$address" 'owner()(address)' --rpc-url "$HSK_TESTNET_RPC")
  [[ ${chain_owner,,} == "${OWNER_ADDRESS,,}" ]] || { echo 'STOP: owner mismatch' >&2; exit 1; }
done
# Read all token/pool addresses from the single verified TypeScript address config.
node --input-type=module -e 'import {addresses} from "./packages/keeper/dist/core/src/addresses.js"; console.log(JSON.stringify(addresses[133]))' > work/testnet-addresses.json
WHSK=$(jq -er '.whsk.address' work/testnet-addresses.json)
USDT=$(jq -er '.usdt.address' work/testnet-addresses.json)
SWAP_ROUTER=$(jq -er '.swapRouter02.address' work/testnet-addresses.json)
QUOTER=$(jq -er '.quoterV2.address' work/testnet-addresses.json)
plan; summary
wrap=$(jq -er '.wrap' work/testnet-plan.json)
swap_in=$(jq -er '.swapIn' work/testnet-plan.json)
[[ $wrap == 0 ]] || send133 "$WHSK" 'deposit()' --value "$wrap"
if [[ $swap_in != 0 ]]; then
  quote=$(cast call "$QUOTER" 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' "($WHSK,$USDT,$swap_in,3000,0)" --rpc-url "$HSK_TESTNET_RPC" | sed -n '1s/ .*//p')
  min_out=$(python3 - "$quote" "$(jq -er '.missingB' work/testnet-plan.json)" <<'PY'
import sys
floor=int(sys.argv[1])*99//100
if floor < int(sys.argv[2]) or floor <= 0:
    sys.exit('STOP: fresh execution quote cannot acquire >=60 test USDT; replan, do not lower minOut.')
print(floor)
PY
)
  send133 "$WHSK" 'approve(address,uint256)' "$SWAP_ROUTER" "$swap_in"
  # Always attempt to reset exact approval if the swap fails or is interrupted.
  reset_approval() { send133 "$WHSK" 'approve(address,uint256)' "$SWAP_ROUTER" 0; }
  trap reset_approval EXIT
  swap_data=$(cast calldata 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))' "($WHSK,$USDT,3000,$DEPLOYER_ADDRESS,$swap_in,$min_out,0)")
  send133 "$SWAP_ROUTER" 'multicall(uint256,bytes[])(bytes[])' "$(( $(date +%s)+300 ))" "[$swap_data]"
  reset_approval
  trap - EXIT
fi
plan
jq -e '.missingB == "0"' work/testnet-plan.json >/dev/null || { echo 'STOP: acquisition did not reach 60 test USDT' >&2; exit 1; }
fund_a=$(jq -er '.vaultNeedA' work/testnet-plan.json)
fund_b=$(jq -er '.vaultNeedB' work/testnet-plan.json)
[[ $fund_a == 0 ]] || send133 "$WHSK" 'transfer(address,uint256)(bool)' "$VAULT_ADDRESS" "$fund_a"
[[ $fund_b == 0 ]] || send133 "$USDT" 'transfer(address,uint256)(bool)' "$VAULT_ADDRESS" "$fund_b"
plan
jq -e '.vaultNeedA == "0" and .vaultNeedB == "0"' work/testnet-plan.json >/dev/null || { echo 'STOP: vault funding thresholds not met' >&2; exit 1; }
plan --policy
summary
jq -r '"policyHash: \(.policyHash)"' work/testnet-plan.json
assert133
(cd contracts && forge script script/MandateCalldata.s.sol --rpc-url "$HSK_TESTNET_RPC" --json > ../work/mandate.json)
jq -er '.returns.setData.value' work/mandate.json > work/set-mandate-calldata.txt
echo 'STOP FOR LEDGER: review policy/agent-v3.json and work/mandate.json. Owner signs setMandate; this script never signs for the owner or starts the agent.'
echo 'After Ledger: start agent, confirm first wake/anchor, verify exported snapshot, add mined vault/router rows to docs/ADDRESSES.md before dashboard/host use.'
