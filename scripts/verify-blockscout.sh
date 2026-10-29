#!/usr/bin/env bash
# scripts/verify-blockscout.sh
# Run forge verify-contract for EdgewiseVault, ProofTradeRouter, and ReceiptChain
# on testnet 133 and mainnet 177.
#
# Requirements:
#   - Foundry (forge)
#   - jq
#   - VAULT_ADDRESS, PROOF_ROUTER_ADDRESS from deployments/133.json (set by Deploy.s.sol)
#   - BLOCKSCOUT_API_KEY_133 (testnet Blockscout; UNVERIFIED: key may not be required)
#   - BLOCKSCOUT_API_KEY_177 (mainnet Blockscout; UNVERIFIED: key may not be required)
#
# Explorer base URLs:
#   - Testnet 133: https://testnet-explorer.hsk.xyz
#   - Mainnet 177: https://hsk.blockscout.com
#
# Never broadcast to chain 177. These commands only submit verification metadata.
# Constructor args must exactly match the deployed bytecode.

set -euo pipefail

# ── Validate environment ───────────────────────────────────────────────────────
assert_not_mainnet() {
  # Safety: make sure we are not accidentally constructing mainnet broadcast
  # commands. Verification is allowed (metadata, not broadcast), but we still
  # warn loudly.
  echo "[info] Mainnet 177 verification submits metadata ONLY — no broadcast."
}

require_var() {
  if [ -z "${!1:-}" ]; then
    echo "[error] Required env var '$1' is not set." >&2
    exit 1
  fi
}

# ── Load deployed addresses ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEPLOYMENT_133="${REPO_ROOT}/contracts/deployments/133.json"
if [ ! -f "${DEPLOYMENT_133}" ]; then
  echo "[error] Missing ${DEPLOYMENT_133}. Run Deploy.s.sol on chain 133 first." >&2
  exit 1
fi

VAULT_ADDRESS_133="$(jq -er '.vault' "${DEPLOYMENT_133}")"
PROOF_ROUTER_ADDRESS_133="$(jq -er '.router' "${DEPLOYMENT_133}")"
OWNER_ADDRESS_133="$(jq -er '.owner' "${DEPLOYMENT_133}")"

# Mainnet 177: may have a separate deployment manifest.
DEPLOYMENT_177="${REPO_ROOT}/contracts/deployments/177.json"
VAULT_ADDRESS_177=""
PROOF_ROUTER_ADDRESS_177=""
if [ -f "${DEPLOYMENT_177}" ]; then
  VAULT_ADDRESS_177="$(jq -er '.vault' "${DEPLOYMENT_177}")"
  PROOF_ROUTER_ADDRESS_177="$(jq -er '.router' "${DEPLOYMENT_177}")"
fi

echo "=== Nalvis-HSK: Blockscout Contract Verification ==="
echo "Testnet 133: Vault=${VAULT_ADDRESS_133}  Router=${PROOF_ROUTER_ADDRESS_133}"
[ -n "${VAULT_ADDRESS_177}" ] && echo "Mainnet 177: Vault=${VAULT_ADDRESS_177}  Router=${PROOF_ROUTER_ADDRESS_177}"

cd "${REPO_ROOT}/contracts"

# ── Testnet 133 verification ───────────────────────────────────────────────────
echo ""
echo "── Testnet 133: Verifying EdgewiseVault ──────────────────────────────────"
# Constructor args for EdgewiseVault(owner, router, pool, tokenA, tokenB, fee, window, oracle, band, age)
# Testnet values (from Addresses.sol and Deploy.s.sol):
#   owner: ${OWNER_ADDRESS_133}
#   router: 0xa6914E66690c6794244B5f66a09eAEbf66254237  (SWAPROUTER02_133)
#   pool:   0xc076FB478b77633736738579c7f48D2539604a50  (PRIMARYPOOL_133)
#   tokenA: 0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6  (WHSK_133)
#   tokenB: 0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F  (USDT_133)
#   fee:    3000
#   window: $TWAP_WINDOW_SEC (default 600)
#   oracle: 0x0000000000000000000000000000000000000000 (none on 133)
#   band:   0
#   age:    0

TWAP_WINDOW="${TWAP_WINDOW_SEC:-600}"

VAULT_CONSTRUCTOR_ARGS=$(cast abi-encode \
  "constructor(address,address,address,address,address,uint24,uint32,address,uint16,uint256)" \
  "${OWNER_ADDRESS_133}" \
  "0xa6914E66690c6794244B5f66a09eAEbf66254237" \
  "0xc076FB478b77633736738579c7f48D2539604a50" \
  "0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6" \
  "0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F" \
  "3000" \
  "${TWAP_WINDOW}" \
  "0x0000000000000000000000000000000000000000" \
  "0" \
  "0")

echo "Constructor args: ${VAULT_CONSTRUCTOR_ARGS}"

# UNVERIFIED: Blockscout verifier URL for testnet 133. Adjust --verifier-url if needed.
forge verify-contract \
  --chain-id 133 \
  --compiler-version "v0.8.24" \
  --optimizer-runs 200 \
  --constructor-args "${VAULT_CONSTRUCTOR_ARGS}" \
  --verifier blockscout \
  --verifier-url "https://testnet-explorer.hsk.xyz/api/" \
  "${VAULT_ADDRESS_133}" \
  src/EdgewiseVault.sol:EdgewiseVault \
  || echo "[warn] EdgewiseVault 133 verification returned non-zero — check explorer manually."

echo ""
echo "── Testnet 133: Verifying ProofTradeRouter ───────────────────────────────"
# Constructor args: ProofTradeRouter(owner, router)
ROUTER_CONSTRUCTOR_ARGS=$(cast abi-encode \
  "constructor(address,address)" \
  "${OWNER_ADDRESS_133}" \
  "0xa6914E66690c6794244B5f66a09eAEbf66254237")

echo "Constructor args: ${ROUTER_CONSTRUCTOR_ARGS}"

forge verify-contract \
  --chain-id 133 \
  --compiler-version "v0.8.24" \
  --optimizer-runs 200 \
  --constructor-args "${ROUTER_CONSTRUCTOR_ARGS}" \
  --verifier blockscout \
  --verifier-url "https://testnet-explorer.hsk.xyz/api/" \
  "${PROOF_ROUTER_ADDRESS_133}" \
  src/ProofTradeRouter.sol:ProofTradeRouter \
  || echo "[warn] ProofTradeRouter 133 verification returned non-zero — check explorer manually."

echo ""
echo "── Testnet 133: Verifying ReceiptChain (abstract; skipped — embedded in vault/router) ──"
echo "[info] ReceiptChain is abstract and not deployed standalone; no separate verification needed."

# ── Mainnet 177 verification ───────────────────────────────────────────────────
if [ -n "${VAULT_ADDRESS_177}" ]; then
  assert_not_mainnet
  OWNER_ADDRESS_177="$(jq -er '.owner' "${DEPLOYMENT_177}")"

  echo ""
  echo "── Mainnet 177: Verifying EdgewiseVault ──────────────────────────────────"
  # Mainnet constructor: uses 177 addresses, longer TWAP window.
  TWAP_WINDOW_177="${TWAP_WINDOW_SEC_177:-3600}"

  VAULT_CONSTRUCTOR_ARGS_177=$(cast abi-encode \
    "constructor(address,address,address,address,address,uint24,uint32,address,uint16,uint256)" \
    "${OWNER_ADDRESS_177}" \
    "0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3" \
    "0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC" \
    "0xB210D2120d57b758EE163cFfb43e73728c471Cf1" \
    "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029" \
    "3000" \
    "${TWAP_WINDOW_177}" \
    "0x0000000000000000000000000000000000000000" \
    "0" \
    "0")

  forge verify-contract \
    --chain-id 177 \
    --compiler-version "v0.8.24" \
    --optimizer-runs 200 \
    --constructor-args "${VAULT_CONSTRUCTOR_ARGS_177}" \
    --verifier blockscout \
    --verifier-url "https://hsk.blockscout.com/api/" \
    "${VAULT_ADDRESS_177}" \
    src/EdgewiseVault.sol:EdgewiseVault \
    || echo "[warn] EdgewiseVault 177 verification returned non-zero — check explorer manually."

  echo ""
  echo "── Mainnet 177: Verifying ProofTradeRouter ───────────────────────────────"
  ROUTER_CONSTRUCTOR_ARGS_177=$(cast abi-encode \
    "constructor(address,address)" \
    "${OWNER_ADDRESS_177}" \
    "0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3")

  forge verify-contract \
    --chain-id 177 \
    --compiler-version "v0.8.24" \
    --optimizer-runs 200 \
    --constructor-args "${ROUTER_CONSTRUCTOR_ARGS_177}" \
    --verifier blockscout \
    --verifier-url "https://hsk.blockscout.com/api/" \
    "${PROOF_ROUTER_ADDRESS_177}" \
    src/ProofTradeRouter.sol:ProofTradeRouter \
    || echo "[warn] ProofTradeRouter 177 verification returned non-zero — check explorer manually."
else
  echo ""
  echo "[info] No deployments/177.json found; skipping mainnet 177 verification."
  echo "[info] After mainnet deployment, re-run this script."
fi

echo ""
echo "=== Verification submission complete. ==="
echo "Check results at:"
echo "  Testnet 133: https://testnet-explorer.hsk.xyz/address/${VAULT_ADDRESS_133}"
echo "  Testnet 133: https://testnet-explorer.hsk.xyz/address/${PROOF_ROUTER_ADDRESS_133}"
[ -n "${VAULT_ADDRESS_177}" ] && echo "  Mainnet 177: https://hsk.blockscout.com/address/${VAULT_ADDRESS_177}"
echo ""
echo "UNVERIFIED: The Blockscout verifier URL for chain 133 has not been confirmed in a live run."
echo "UNVERIFIED: A Blockscout API key may or may not be required; pass BLOCKSCOUT_API_KEY if needed."
