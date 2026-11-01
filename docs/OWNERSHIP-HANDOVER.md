# Ledger ownership handover (pending)

The deployed EdgewiseVault and ProofTradeRouter are currently owned by
`0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927`. No final Ledger address has been
independently supplied and verified. Do not initiate the handover until the
address is verified and the owner explicitly authorizes it. No Ledger was
connected during this work.

## Two-step process for each contract

Ownership is independent per contract. The current owner must nominate the
verified Ledger address with `transferOwnership(ledgerAddress)`. The nominated
Ledger must then call `acceptOwnership()` on that same contract. This is four
transactions total for both contracts. The current owner can cancel an
unaccepted nomination with `transferOwnership(address(0))`. Acceptance does
not configure a mandate, change the router policy, or move tokens.

HashKey chain 133 does not have Ledger clear-signing metadata. The UI warns that
the operation is blind signing. Verify calldata and the target address on the
device. This guide is not authorization to sign or broadcast.

## Read-only checks before nomination

Use the addresses in [DEPLOYMENT.md](DEPLOYMENT.md), a trusted RPC, and only
read commands:

```powershell
$rpc = "https://testnet.hsk.xyz"
$vault = "0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc"
$router = "0xC5Fa869C8423B41696886A7761ec31b3846f4e4B"
cast chain-id --rpc-url $rpc
cast call $vault "owner()(address)" --rpc-url $rpc
cast call $vault "pendingOwner()(address)" --rpc-url $rpc
cast call $router "owner()(address)" --rpc-url $rpc
cast call $router "pendingOwner()(address)" --rpc-url $rpc
cast call $vault "mandate()(address,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint256,bytes32)" --rpc-url $rpc
cast call $router "policyHash()(bytes32)" --rpc-url $rpc
```

Confirm chain ID is 133; both owners are the expected temporary owner; pending
owners are zero (or consciously resolve an existing pending transfer); the
Ledger address is independently verified; and vault/router policy hashes
match. Do not print or share signer credentials.

## Read-only checks after acceptance

After the human completes the separately authorized transactions, rerun:

```powershell
cast chain-id --rpc-url $rpc
cast call $vault "owner()(address)" --rpc-url $rpc
cast call $vault "pendingOwner()(address)" --rpc-url $rpc
cast call $router "owner()(address)" --rpc-url $rpc
cast call $router "pendingOwner()(address)" --rpc-url $rpc
cast call $vault "mandate()(address,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint256,bytes32)" --rpc-url $rpc
cast call $router "policyHash()(bytes32)" --rpc-url $rpc
```

Expected: both owner values equal the verified Ledger address, both pending
owners are zero, and mandate agent/limits/policy plus router policy remain
unchanged. Record the four transaction hashes and confirmed block data in the
deployment manifest only after checking successful receipts. Never use chain
177 for writes.
