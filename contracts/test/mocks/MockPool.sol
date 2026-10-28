// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockPool {
    address public immutable token0;
    address public immutable token1;
    uint24 public constant fee = 3000;
    int24 public tick;
    int56 public remainder;
    bool public fail;

    constructor(address a, address b) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function setTick(int24 t, int56 r) external {
        tick = t;
        remainder = r;
    }

    function setFail(bool f) external {
        fail = f;
    }

    function observe(uint32[] calldata times) external view returns (int56[] memory c, uint160[] memory s) {
        require(!fail, "observe failed");
        require(times.length == 2 && times[1] == 0, "window");
        c = new int56[](2);
        s = new uint160[](2);
        c[1] = int56(tick) * int56(uint56(times[0])) + remainder;
    }
}
