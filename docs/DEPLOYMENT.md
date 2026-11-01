# HSK Testnet deployment and configuration

This is a read-only record of the existing deployment. Do not redeploy these
contracts. No write operation was performed for this documentation update.

## Network and deployed contracts

- Network: HSK Testnet, chain ID 133.
- RPC: `https://testnet.hsk.xyz`.
- Explorer: `https://testnet-explorer.hskchain.net`.
- Source commit used for deployment: `00f79c4ea5fcced27b3e33940a62ba56928f1b7e`.
- Current manifest: [`contracts/deployments/133.json`](../contracts/deployments/133.json).

| Contract | Address | Deployment transaction | Block | Gas |
|---|---|---|---:|---:|
| EdgewiseVault | `0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc` | `0xcb7480c81476eb9eb76f4ef7eab8e872e3d5c94cde4b23173b1ca9ad247c6941` | 35175424 | 3531069 |
| ProofTradeRouter | `0xC5Fa869C8423B41696886A7761ec31b3846f4e4B` | `0x24519a67fa5a3f4e050ce73249b0099503fcad08424b106ad8a9fed70cae031f` | 35175424 | 901698 |

The deployer was `0xee9A370e88385E7f366E1e7c88D73F3a1691fEe1`; the current
temporary owner of both contracts is
`0x82437E9Bb58cFf40B996818CCcdF1523fC5cE927`. The configured agent is
`0x6845a4caCcEaCd6eE5407C9E217610c26964ba2a`. The three roles are distinct.
The deployment receipts succeeded and both addresses have bytecode.

## Confirmed on-chain configuration

At block `35176631` (block hash
`0x0803844f0180c8d4b8644f3c2e39a3212dde97d7a3ef7e748ddea236733a68d0`,
2026-11-01 13:31:58 UTC), the chain-133 RPC returned the following:

- Both contracts' `owner()` is the temporary owner; both `pendingOwner()` values
  are zero.
- Vault agent: `0x6845a4caCcEaCd6eE5407C9E217610c26964ba2a`.
- Mandate: expiry Unix `1794143836`; 2 WHSK per trade; 100 test-USDT per
  trade; 500 test-USDT per rolling 24 hours; 8000-bps exposure; 100-bps slippage;
  2000-bps drawdown; 300-second minimum interval.
- Vault mandate policy hash and router policy hash both equal
  `0xabeadf083e801ceaed5a290b5800095cd7243a791fe72419172017b32b048027`.
- The deployed vault enforces `validUntil` on each trade and exposes
  `getRolling24hTurnover()` for its 48-bucket rolling cap. Current turnover is
  queryable without a state-changing call.
- The on-chain configuration transactions succeeded: `setMandate` transaction
  `0xd1fa870f122a08b0faec47471cc658b4f390beb7fa018dda6bc8c696cadbb660`
  (block 35176370, 241726 gas); `setPolicy` transaction
  `0x6c016ebbf96d111d15941c7cb06b3431b9450db3ff2bbe39ee3a21094150638f`
  (block 35176430, 47135 gas).
- WHSK and test-USDT each have 18 decimals on this testnet. Both vault token
  balances were zero at the verification block.

The hash corresponds to `policy/default.json` as used by the existing project.
The constructor uses SwapRouter02
`0xa6914E66690c6794244B5f66a09eAEbf66254237`, the 0.3% pool
`0xc076FB478b77633736738579c7f48D2539604a50`, WHSK
`0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6`, test-USDT
`0x98B6173A8B7DFc52ce8bc88f1184a918A1CCaa4F`, and a disabled (zero-address)
oracle. External contract address records are in [ADDRESSES.md](ADDRESSES.md).

## Read-only recheck commands

Run from PowerShell with Foundry installed; these commands do not sign or send:

```powershell
$rpc = "https://testnet.hsk.xyz"
$vault = "0x74E181cd60C6880D5835b06A3EAEd1727F65c4cc"
$router = "0xC5Fa869C8423B41696886A7761ec31b3846f4e4B"
cast chain-id --rpc-url $rpc
cast receipt 0xcb7480c81476eb9eb76f4ef7eab8e872e3d5c94cde4b23173b1ca9ad247c6941 --rpc-url $rpc
cast receipt 0x24519a67fa5a3f4e050ce73249b0099503fcad08424b106ad8a9fed70cae031f --rpc-url $rpc
cast code $vault --rpc-url $rpc
cast code $router --rpc-url $rpc
cast call $vault "owner()(address)" --rpc-url $rpc
cast call $vault "pendingOwner()(address)" --rpc-url $rpc
cast call $vault "mandate()(address,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint256,bytes32)" --rpc-url $rpc
cast call $vault "getRolling24hTurnover()(uint256)" --rpc-url $rpc
cast call $router "owner()(address)" --rpc-url $rpc
cast call $router "pendingOwner()(address)" --rpc-url $rpc
cast call $router "policyHash()(bytes32)" --rpc-url $rpc
```

No vault funding, approvals, wrapping, swaps, ownership change or testnet
execution is part of this deployment record. The zero balances block the
funded TRADE/RESIZE demonstration. Do not use the permissionless router as a
substitute for the vault's on-chain mandate enforcement.
