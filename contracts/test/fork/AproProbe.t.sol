// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test, console2} from "forge-std/Test.sol";
import {Addresses} from "../../script/Addresses.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

contract AproReader {
    function read() external view returns (int256 answer) {
        (, answer,,,) = IAggregatorV3(Addresses.APRO_177).latestRoundData();
    }
}

contract AproProbeTest is Test {
    function testContractCallerAPRO() public {
        string memory rpc = vm.envOr("HSK_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            console2.log("SKIP: no RPC for APRO probe");
            vm.skip(true);
        }
        try vm.createSelectFork(rpc, vm.envOr("FORK_BLOCK_177", uint256(29413000))) returns (uint256) {}
        catch {
            console2.log("SKIP: RPC unavailable for APRO probe");
            vm.skip(true);
        }
        AproReader reader = new AproReader();
        try reader.read() returns (int256 answer) {
            assertGt(answer, 0);
            console2.log("APRO: normal deployed contract read succeeds");
        } catch {
            console2.log("APRO: normal deployed contract read REVERTS; disable on-chain oracle");
        }
    }
}
