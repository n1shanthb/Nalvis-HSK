// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Addresses} from "../../script/Addresses.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {IQuoterV2} from "../../src/interfaces/IQuoterV2.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice Remote state is read into a local EVM; never broadcasts.
contract ForkSmokeTest is Test {
    function testMainnetReadOnlySmoke() public {
        string memory rpc = vm.envOr("HSK_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            console2.log("SKIP: no RPC");
            return;
        }
        uint256 pinnedBlock = vm.envOr("FORK_BLOCK_177", uint256(29413000));
        try vm.createSelectFork(rpc, pinnedBlock) returns (uint256) {
            console2.log("ForkSmoke: connected to mainnet fork at block", pinnedBlock);
        } catch {
            console2.log("SKIP: RPC unreachable or pinned historical state unavailable");
            return;
        }
        assertEq(block.chainid, 177);
        IUniswapV3Pool pool = IUniswapV3Pool(Addresses.PRIMARYPOOL_177);
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        assertGt(sqrtPriceX96, 0);
        assertEq(pool.token0(), Addresses.WHSK_177);
        assertEq(pool.token1(), Addresses.USDT_177);
        assertEq(pool.fee(), 3000);
        IQuoterV2.QuoteExactInputSingleParams memory params = IQuoterV2.QuoteExactInputSingleParams({
            tokenIn: Addresses.USDT_177, tokenOut: Addresses.WHSK_177, amountIn: 100e6, fee: 3000, sqrtPriceLimitX96: 0
        });
        // Local CALL is the eth_call equivalent: STATICCALL would forbid the
        // Quoter's simulated pool writes. No remote transaction is submitted.
        try IQuoterV2(Addresses.QUOTERV2_177).quoteExactInputSingle(params) returns (
            uint256 amountOut, uint160, uint32, uint256
        ) {
            assertGt(amountOut, 0);
        } catch (bytes memory reason) {
            // UNVERIFIED fallback: accept only the complete quote tuple.
            assertEq(reason.length, 128, "Unexpected QuoterV2 revert format");
            (uint256 amountOut,,,) = abi.decode(reason, (uint256, uint160, uint32, uint256));
            assertGt(amountOut, 0);
        }
        IAggregatorV3 oracle = IAggregatorV3(Addresses.APRO_177);
        assertEq(oracle.decimals(), 8);
        // APRO restricts contract callers; emulate an EOA eth_call locally.
        address reader = vm.addr(1);
        vm.prank(reader, reader);
        (, int256 answer,,,) = oracle.latestRoundData();
        assertGt(answer, 0); // Known stale: deliberately no freshness assertion.
    }
}
