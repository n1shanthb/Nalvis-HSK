// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal local mutex; no external dependency.
abstract contract ReentrancyGuard {
    uint256 private entered = 1;
    error Reentrancy();
    modifier nonReentrant() {
        if (entered != 1) revert Reentrancy();
        entered = 2;
        _;
        entered = 1;
    }
}
