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

    function setUp() public {
        vm.chainId(31337);
        vm.warp(10 days);
        agent = makeAddr("agent");
        vm.setEnv("OWNER_ADDRESS", vm.toString(makeAddr("owner")));
        vm.setEnv("AGENT_ADDRESS", vm.toString(agent));
        MockERC20 token = new MockERC20(18);
        vm.etch(Addresses.WHSK_133, address(token).code);
        vm.etch(Addresses.USDT_133, address(token).code);
        helper = new MandateCalldata();
    }

    function testDefaultCalldataAndRevoke() public {
        vm.setEnv("OWNER_ADDRESS", vm.toString(makeAddr("owner")));
        vm.setEnv("AGENT_ADDRESS", vm.toString(agent));
        (bytes memory setData, bytes memory revokeData) = helper.run();
        bytes32 policy;
        string memory path = string.concat(vm.projectRoot(), "/../policy/default.json");
        if (vm.exists(path)) policy = keccak256(bytes(vm.readFile(path)));
        EdgewiseVault.Mandate memory m =
            EdgewiseVault.Mandate(agent, block.timestamp + 7 days, 2e18, 100e18, 500e18, 8000, 100, 0, 300, policy);
        assertEq(setData, abi.encodeCall(EdgewiseVault.setMandate, (m)));
        assertEq(revokeData, abi.encodeCall(EdgewiseVault.revoke, ()));
    }

    function testRejectMainnet() public {
        vm.chainId(177);
        vm.expectRevert("Mandate: only chains 133/31337");
        helper.run();
    }

    function testRejectEqualRoles() public {
        vm.setEnv("OWNER_ADDRESS", vm.toString(agent));
        vm.expectRevert("Mandate: invalid roles");
        helper.run();
        vm.setEnv("OWNER_ADDRESS", vm.toString(makeAddr("owner")));
    }

    function testRejectWrongDecimals() public {
        MockERC20 token = new MockERC20(6);
        vm.etch(Addresses.USDT_133, address(token).code);
        vm.expectRevert("Mandate: unexpected testnet decimals");
        helper.run();
    }
}
