// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockAggregator {
    uint8 public decimals = 8;
    int256 public answer = 1e8;
    uint256 public updatedAt;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;
    bool public fail;

    constructor() {
        updatedAt = block.timestamp;
    }

    function set(int256 a, uint256 t, uint80 r, uint80 answered) external {
        answer = a;
        updatedAt = t;
        roundId = r;
        answeredInRound = answered;
    }

    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function setFail(bool f) external {
        fail = f;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!fail, "oracle failed");
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}
