// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {TickMath} from "../../src/lib/TickMath.sol";
import {FullMath} from "../../src/lib/FullMath.sol";

contract MathPortsTest is Test {
    function testTickVectors() public pure {
        assertEq(TickMath.getSqrtRatioAtTick(0), 1 << 96);
        assertEq(TickMath.getSqrtRatioAtTick(-887272), 4295128739);
        assertEq(TickMath.getSqrtRatioAtTick(887272), 1461446703485210103287273052203988822378723970342);
        assertEq(TickMath.getSqrtRatioAtTick(1), 79232123823359799118286999568);
        assertEq(TickMath.getSqrtRatioAtTick(-1), 79224201403219477170569942574);
    }

    function testFullMathPhantomOverflow() public pure {
        assertEq(FullMath.mulDiv(1 << 200, 1 << 100, 1 << 50), 1 << 250);
        assertEq(FullMath.mulDiv(type(uint256).max, type(uint256).max, type(uint256).max), type(uint256).max);
        assertEq(FullMath.mulDiv(100, 10, 6), 166);
    }

    function testFuzzFullMath(uint128 a, uint128 b, uint128 denominator) public pure {
        if (denominator == 0) denominator = 1;
        assertEq(FullMath.mulDiv(a, b, denominator), uint256(a) * b / denominator);
    }

    function testFuzzTicksMonotonic(int24 t) public pure {
        int24 tick = int24(bound(int256(t), -887272, 887271));
        assertLt(TickMath.getSqrtRatioAtTick(tick), TickMath.getSqrtRatioAtTick(tick + 1));
    }
}
