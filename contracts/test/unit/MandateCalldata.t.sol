// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {MandateCalldata} from "../../script/MandateCalldata.s.sol";
import {Addresses} from "../../script/Addresses.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract MandateCalldataTest is Test {
    MandateCalldata helper;
    address agent;
    address owner;
    uint256 drawdown = 2000;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(10 days);
        agent = makeAddr("agent");
        owner = makeAddr("owner");

        drawdown = 2000;
        MockERC20 token = new MockERC20(18);
        vm.etch(Addresses.WHSK_133, address(token).code);
        vm.etch(Addresses.USDT_133, address(token).code);
        helper = new MandateCalldata();
    }

    function _setRoles() internal {
        owner = makeAddr("owner");
    }

    function testMandateCalldata() public {
        _setRoles();

        // 1. Default drawdown (2000 bps)
        drawdown = 2000;
        (bytes memory setData, bytes memory revokeData) = helper.build(owner, agent, drawdown);
        bytes32 policy;
        string memory path = string.concat(vm.projectRoot(), "/../policy/default.json");
        if (vm.exists(path)) policy = keccak256(bytes(vm.readFile(path)));
        EdgewiseVault.Mandate memory mDefault =
            EdgewiseVault.Mandate(agent, block.timestamp + 7 days, 2e18, 100e18, 500e18, 8000, 100, 2000, 300, policy);
        assertEq(setData, abi.encodeCall(EdgewiseVault.setMandate, (mDefault)));
        assertEq(revokeData, abi.encodeCall(EdgewiseVault.revoke, ()));

        // 2. Explicit drawdown (1500 bps)
        drawdown = 1500;
        (setData,) = helper.build(owner, agent, drawdown);
        EdgewiseVault.Mandate memory mCustom =
            EdgewiseVault.Mandate(agent, block.timestamp + 7 days, 2e18, 100e18, 500e18, 8000, 100, 1500, 300, policy);
        assertEq(setData, abi.encodeCall(EdgewiseVault.setMandate, (mCustom)));

        // 3. Out of bounds (> 10000 bps)
        drawdown = 10001;
        vm.expectRevert("Mandate: maxDrawdownBps must be <= 10000");
        helper.build(owner, agent, drawdown);
        drawdown = 2000;

        // 4. Reject equal roles
        owner = agent;

        vm.expectRevert("Mandate: invalid roles");
        helper.build(owner, agent, drawdown);
        _setRoles();

        // 5. Reject mainnet
        vm.chainId(177);
        vm.expectRevert("Mandate: only chains 133/31337");
        helper.build(owner, agent, drawdown);
        vm.chainId(31337);

        // 6. Reject wrong decimals
        MockERC20 token = new MockERC20(6);
        vm.etch(Addresses.USDT_133, address(token).code);
        vm.expectRevert("Mandate: unexpected testnet decimals");
        helper.build(owner, agent, drawdown);
    }
}
