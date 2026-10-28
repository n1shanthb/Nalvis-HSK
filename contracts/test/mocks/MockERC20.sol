// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockERC20 {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public returnFalse;
    bool public feeOnTransfer;
    bool public requireReset;

    constructor(uint8 d) {
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function configure(bool fail, bool tax, bool reset) external {
        returnFalse = fail;
        feeOnTransfer = tax;
        requireReset = reset;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (returnFalse) return false;
        require(!requireReset || amount == 0 || allowance[msg.sender][spender] == 0, "reset");
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (returnFalse) return false;
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (returnFalse) return false;
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        balanceOf[from] -= amount;
        balanceOf[to] += feeOnTransfer ? amount - amount / 100 : amount;
    }
}
