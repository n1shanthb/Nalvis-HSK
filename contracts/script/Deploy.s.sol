// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {Addresses} from "./Addresses.sol";
import {EdgewiseVault} from "../src/EdgewiseVault.sol";
import {ProofTradeRouter} from "../src/ProofTradeRouter.sol";

/// @notice Human-only testnet deployment; Codex broadcasts only to local Anvil.
contract Deploy is Script {
    /// @notice Validate roles and deploy using the CLI-selected sender; never reads a key.
    function run() external returns (EdgewiseVault vault, ProofTradeRouter router) {
        require(block.chainid == 133 || block.chainid == 31337, "Deploy: only chains 133/31337");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        uint256 window = vm.envOr("TWAP_WINDOW_SEC", uint256(600));
        require(window > 0 && window <= type(uint32).max, "Deploy: invalid TWAP window");
        string memory commit = vm.envString("DEPLOY_COMMIT");
        require(bytes(commit).length == 40, "Deploy: full git commit required");
        for (uint256 i; i < 40; ++i) {
            bytes1 c = bytes(commit)[i];
            require((c >= "0" && c <= "9") || (c >= "a" && c <= "f"), "Deploy: invalid commit");
        }
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        (vault, router) = _deploy(owner, agent, deployer, uint32(window));
        vm.stopBroadcast();
        string memory obj = "deployment";
        vm.serializeAddress(obj, "vault", address(vault));
        vm.serializeAddress(obj, "router", address(router));
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeAddress(obj, "agent", agent);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeUint(obj, "block", block.number);
        string memory json = vm.serializeString(obj, "commit", commit);
        string memory dir = string.concat(vm.projectRoot(), "/deployments");
        vm.createDir(dir, true);
        vm.writeJson(json, string.concat(dir, "/", vm.toString(block.chainid), ".json"));
        console2.log("Vault", address(vault));
        console2.log("ProofTradeRouter", address(router));
        console2.log("Manifest is simulation output: verify broadcast receipts before using it.");
    }

    /// @dev Shared deployment logic, exposed only by the test harness.
    function _deploy(address owner, address agent, address deployer, uint32 window)
        internal
        returns (EdgewiseVault vault, ProofTradeRouter router)
    {
        require(block.chainid == 133 || block.chainid == 31337, "Deploy: only chains 133/31337");
        require(owner != address(0) && agent != address(0) && deployer != address(0), "Deploy: zero role");
        require(owner != agent && owner != deployer && agent != deployer, "Deploy: roles must be distinct");
        vault = new EdgewiseVault(
            owner,
            Addresses.SWAPROUTER02_133,
            Addresses.PRIMARYPOOL_133,
            Addresses.WHSK_133,
            Addresses.USDT_133,
            3000,
            window,
            address(0),
            0,
            0
        );
        router = new ProofTradeRouter(owner, Addresses.SWAPROUTER02_133);
    }
}
