// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {DeployMainnet} from "../../script/DeployMainnet.s.sol";

contract MainnetDeploymentTest is Test {
    function testRefusesWrongChain() public {
        vm.chainId(133);
        DeployMainnet script = new DeployMainnet();
        vm.expectRevert("Mainnet: chain 177 required");
        script.run();
    }

    function testRefusesWithoutExplicitAcknowledgement() public {
        vm.chainId(177);
        vm.setEnv("MAINNET_EXECUTION_ACK", "");
        DeployMainnet script = new DeployMainnet();
        vm.expectRevert("Mainnet: acknowledgement required");
        script.run();
    }
}
