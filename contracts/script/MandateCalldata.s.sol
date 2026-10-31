// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {EdgewiseVault} from "../src/EdgewiseVault.sol";
import {Addresses} from "./Addresses.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice Read-only calldata builder. No signing or broadcasting.
contract MandateCalldata is Script {
    /// @notice Build the default testnet mandate for human review on a Ledger.
    function run() external view returns (bytes memory setData, bytes memory revokeData) {
        require(block.chainid == 133 || block.chainid == 31337, "Mandate: only chains 133/31337");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        require(owner != address(0) && agent != address(0) && owner != agent, "Mandate: invalid roles");
        uint256 drawdownEnv = 2000;
        if (vm.envExists("MAX_DRAWDOWN_BPS")) {
            string memory val = vm.envString("MAX_DRAWDOWN_BPS");
            if (bytes(val).length > 0) {
                drawdownEnv = vm.envUint("MAX_DRAWDOWN_BPS");
            }
        }
        return build(owner, agent, drawdownEnv);
    }

    /// @notice Explicit inputs avoid process-global environment races in callers/tests.
    function build(address owner, address agent, uint256 drawdownEnv)
        public
        view
        returns (bytes memory setData, bytes memory revokeData)
    {
        require(block.chainid == 133 || block.chainid == 31337, "Mandate: only chains 133/31337");
        require(owner != address(0) && agent != address(0) && owner != agent, "Mandate: invalid roles");
        uint8 da = IERC20(Addresses.WHSK_133).decimals();
        uint8 db = IERC20(Addresses.USDT_133).decimals();
        require(da == 18 && db == 18, "Mandate: unexpected testnet decimals");
        string memory path = string.concat(vm.projectRoot(), "/../policy/default.json");
        bytes32 policy;
        if (vm.exists(path)) {
            // Policy files must already be canonical sorted-key JSON, no whitespace.
            // Hash exact bytes, never silently reinterpret a policy the human reviews.
            policy = keccak256(bytes(vm.readFile(path)));
        } else {
            console2.log("WARNING: policy/default.json missing; policyHash = bytes32(0)");
        }
        require(drawdownEnv <= 10000, "Mandate: maxDrawdownBps must be <= 10000");
        uint16 maxDrawdownBps = uint16(drawdownEnv);
        EdgewiseVault.Mandate memory m = EdgewiseVault.Mandate(
            agent,
            block.timestamp + 7 days,
            2 * 10 ** da,
            100 * 10 ** db,
            500 * 10 ** db,
            8000,
            100,
            maxDrawdownBps,
            300,
            policy
        );
        setData = abi.encodeCall(EdgewiseVault.setMandate, (m));
        revokeData = abi.encodeCall(EdgewiseVault.revoke, ());
        console2.log("TESTNET: prices are fake. Ledger blind signing on 133 is UNVERIFIED.");
        console2.log("Owner", owner);
        console2.log("Agent", agent);
        console2.log("Expiry (UTC unix seconds)", m.expiry);
        console2.log("WHSK decimals", uint256(da));
        console2.log("Test-USDT decimals", uint256(db));
        console2.log("Caps: 2 WHSK/trade; 100 test-USDT/trade; 500 test-USDT/UTC day");
        console2.log("Exposure cap: 8000 bps (strict risk reduction allowed); slippage: 100 bps; interval: 300 sec");
        console2.log("policyHash");
        console2.logBytes32(policy);
        console2.log("setMandate calldata");
        console2.logBytes(setData);
        console2.log("revoke calldata");
        console2.logBytes(revokeData);
    }
}
