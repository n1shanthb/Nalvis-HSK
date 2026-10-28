// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test, console2} from "forge-std/Test.sol";
import {Addresses} from "../../script/Addresses.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {FullMath} from "../../src/lib/FullMath.sol";
import {TickMath} from "../../src/lib/TickMath.sol";
import {AproReader} from "./AproProbe.t.sol";

abstract contract ForkBase is Test {
    uint256 internal constant ORACLE_MAX_AGE = 7 days;
    uint32 internal constant WINDOW = 300;
    address internal feed;

    function _fork() internal {
        string memory rpc = vm.envOr("HSK_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            console2.log("SKIP: no RPC");
            vm.skip(true);
        }
        try vm.createSelectFork(rpc, vm.envOr("FORK_BLOCK_177", uint256(29413000))) returns (uint256) {}
            catch {
            console2.log("SKIP: RPC unreachable or pinned state unavailable");
            vm.skip(true);
        }
        assertEq(block.chainid, 177);
        AproReader reader = new AproReader();
        try reader.read() returns (int256 answer) {
            assertGt(answer, 0);
            feed = Addresses.APRO_177;
            console2.log("APRO contract read succeeds; oracleMaxAge = 604800 seconds");
        } catch {
            feed = address(0);
            console2.log("APRO contract read reverts: oracle disabled, off-chain evidence only");
        }
    }

    function fundUSDT(address recipient, uint256 amount) external {
        require(msg.sender == address(this));
        deal(Addresses.USDT_177, recipient, amount);
    }

    function _fund(address recipient, uint256 amount) internal {
        try this.fundUSDT(recipient, amount) {
            console2.log("USDT funding: forge-std deal() worked");
        }
        catch {
            vm.prank(Addresses.PRIMARYPOOL_177);
            require(IERC20(Addresses.USDT_177).transfer(recipient, amount));
            console2.log("USDT funding: impersonated pool holder transfer");
        }
        assertEq(IERC20(Addresses.USDT_177).balanceOf(recipient), amount);
    }

    function _ref(uint256 amount) internal view returns (uint256) {
        uint32[] memory times = new uint32[](2);
        times[0] = WINDOW;
        (int56[] memory c,) = IUniswapV3Pool(Addresses.PRIMARYPOOL_177).observe(times);
        int56 d = c[1] - c[0];
        int56 w = int56(uint56(WINDOW));
        int24 tick = int24(d / w);
        if (d < 0 && d % w != 0) --tick;
        uint160 sqrt = TickMath.getSqrtRatioAtTick(tick);
        return FullMath.mulDiv(1 << 192, amount, uint256(sqrt) * sqrt);
    }
}
