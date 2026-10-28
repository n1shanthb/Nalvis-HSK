// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {EdgewiseVault} from "../src/EdgewiseVault.sol";
import {ReceiptChain} from "../src/ReceiptChain.sol";
import {Addresses} from "./Addresses.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3Pool.sol";
import {FullMath} from "../src/lib/FullMath.sol";
import {TickMath} from "../src/lib/TickMath.sol";

/// @notice Read-only first-trade calldata for the human bootstrap; not a keeper.
contract TradeCalldata is Script {
    /// @notice Sell 0.01 test WHSK with the default mandate's 1% TWAP floor.
    function run() external view returns (bytes memory tradeData) {
        require(block.chainid == 133 || block.chainid == 31337, "Trade: only chains 133/31337");
        EdgewiseVault vault = EdgewiseVault(vm.envAddress("VAULT_ADDRESS"));
        require(
            vault.tokenA() == Addresses.WHSK_133 && vault.tokenB() == Addresses.USDT_133
                && vault.pool() == Addresses.PRIMARYPOOL_133,
            "Trade: unexpected vault pair"
        );
        uint32[] memory times = new uint32[](2);
        times[0] = vault.twapWindowSec();
        (int56[] memory c,) = IUniswapV3Pool(vault.pool()).observe(times);
        int56 delta = c[1] - c[0];
        int56 window = int56(uint56(times[0]));
        int24 tick = int24(delta / window);
        if (delta < 0 && delta % window != 0) --tick;
        uint160 sqrt = TickMath.getSqrtRatioAtTick(tick);
        // Testnet tokenA sorts after tokenB. Quote tokenA -> tokenB.
        uint256 refOut;
        if (sqrt <= type(uint128).max) {
            refOut = FullMath.mulDiv(1 << 192, 0.01 ether, uint256(sqrt) * sqrt);
        } else {
            refOut = FullMath.mulDiv(1 << 128, 0.01 ether, FullMath.mulDiv(sqrt, sqrt, 1 << 64));
        }
        uint256 minOut = refOut * 99 / 100;
        require(minOut > 0, "Trade: zero reference");
        tradeData = abi.encodeCall(
            EdgewiseVault.trade,
            (EdgewiseVault.TradeParams(
                    Addresses.WHSK_133,
                    0.01 ether,
                    minOut,
                    block.timestamp + 300,
                    vault.nextNonce(),
                    keccak256("T3 human bootstrap: testnet prices are fake"),
                    vault.head(),
                    ReceiptChain.Kind.TRADE
                ))
        );
        console2.log("TESTNET prices are fake; sell 0.01 WHSK; minOut raw test-USDT", minOut);
        console2.log("Rebuild if stale; a changed TWAP or insufficient quote must revert, never lower the floor.");
        console2.logBytes(tradeData);
    }
}
