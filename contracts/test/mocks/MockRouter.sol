// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IV3SwapRouter} from "../../src/interfaces/IV3SwapRouter.sol";
import {FullMath} from "../../src/lib/FullMath.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";

contract MockRouter {
    uint256 public numerator = 1;
    uint256 public denominator = 1;
    bool public underfill;
    address public callback;
    bytes public callbackData;

    function setPrice(uint256 n, uint256 d) external {
        numerator = n;
        denominator = d;
    }

    function setUnderfill(bool f) external {
        underfill = f;
    }

    function setCallback(address target, bytes calldata data) external {
        callback = target;
        callbackData = data;
    }

    function exactInputSingle(IV3SwapRouter.ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        require(IERC20(p.tokenIn).allowance(msg.sender, address(this)) == p.amountIn, "exact approval");
        require(IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn));
        if (callback != address(0)) {
            (bool ok,) = callback.call(callbackData);
            require(ok, "callback failed");
        }
        out = underfill ? p.amountOutMinimum - 1 : FullMath.mulDiv(p.amountIn, numerator, denominator);
        require(IERC20(p.tokenOut).transfer(p.recipient, out));
    }
}
