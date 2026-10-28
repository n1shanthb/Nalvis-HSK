// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IERC20} from "../interfaces/IERC20.sol";

/// @notice Minimal optional-return ERC20 calls, supporting USDT-style tokens.
library SafeToken {
    error TokenCall();
    error InexactTransfer();

    function callToken(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || token.code.length == 0 || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCall();
    }

    function approve(address token, address spender, uint256 amount) internal {
        callToken(token, abi.encodeCall(IERC20.approve, (spender, amount)));
    }

    function transfer(address token, address to, uint256 amount) internal {
        callToken(token, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function pull(address token, address from, uint256 amount) internal {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        callToken(token, abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        if (IERC20(token).balanceOf(address(this)) != beforeBalance + amount) revert InexactTransfer();
    }
}
