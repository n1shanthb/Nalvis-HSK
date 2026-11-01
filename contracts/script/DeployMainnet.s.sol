// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Script} from "forge-std/Script.sol";
import {Addresses} from "./Addresses.sol";
import {EdgewiseVault} from "../src/EdgewiseVault.sol";
import {ProofTradeRouter} from "../src/ProofTradeRouter.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice Human-only mainnet deployment. Default is simulation; keys are CLI-selected.
contract DeployMainnet is Script {
    function run() external returns (EdgewiseVault vault, ProofTradeRouter router) {
        require(block.chainid == 177, "Mainnet: chain 177 required");
        require(
            keccak256(bytes(vm.envString("MAINNET_EXECUTION_ACK"))) == keccak256("I_ACCEPT_REAL_FUNDS_RISK_ON_177"),
            "Mainnet: acknowledgement required"
        );
        address owner = vm.envAddress("OWNER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        string memory commit = vm.envString("DEPLOY_COMMIT");
        require(bytes(commit).length == 40, "Mainnet: commit required");
        for (uint256 i; i < 40; ++i) {
            bytes1 c = bytes(commit)[i];
            require((c >= "0" && c <= "9") || (c >= "a" && c <= "f"), "Mainnet: invalid commit");
        }
        require(
            IERC20(Addresses.WHSK_177).decimals() == 18 && IERC20(Addresses.USDT_177).decimals() == 6,
            "Mainnet: decimals mismatch"
        );
        require(
            Addresses.SWAPROUTER02_177.code.length > 0 && Addresses.PRIMARYPOOL_177.code.length > 0,
            "Mainnet: missing dependencies"
        );
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        require(owner != address(0) && agent != address(0) && deployer != address(0), "Mainnet: zero role");
        require(owner != agent && owner != deployer && agent != deployer, "Mainnet: distinct roles required");
        // APRO rejects normal contract calls; use reviewed pool TWAP only, never fake oracle protection.
        vault = new EdgewiseVault(
            owner,
            Addresses.SWAPROUTER02_177,
            Addresses.PRIMARYPOOL_177,
            Addresses.WHSK_177,
            Addresses.USDT_177,
            3000,
            600,
            address(0),
            0,
            0
        );
        router = new ProofTradeRouter(owner, Addresses.SWAPROUTER02_177);
        vm.stopBroadcast();
        string memory obj = "mainnet";
        vm.serializeAddress(obj, "vault", address(vault));
        vm.serializeAddress(obj, "router", address(router));
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeAddress(obj, "agent", agent);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeUint(obj, "block", block.number);
        string memory json = vm.serializeString(obj, "commit", commit);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/177.simulation.json"));
        // Human verifies BOTH mined receipts and registry before publishing 177.json.
    }
}
