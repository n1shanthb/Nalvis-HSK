// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ForkBase} from "./ForkBase.sol";
import {console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Addresses} from "../../script/Addresses.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

contract VaultForkTest is ForkBase {
    EdgewiseVault v;
    address agent;
    bytes32 policy;

    function setUp() public {
        _fork();
        agent = makeAddr("fork agent");
        policy = keccak256("fork policy");
        v = _vault(ORACLE_MAX_AGE);
        _fund(address(v), 1000e6);
    }

    function _vault(uint256 age) internal returns (EdgewiseVault vault) {
        vault = new EdgewiseVault(
            address(this),
            Addresses.SWAPROUTER02_177,
            Addresses.PRIMARYPOOL_177,
            Addresses.WHSK_177,
            Addresses.USDT_177,
            3000,
            WINDOW,
            feed,
            1000,
            age
        );
        vault.setMandate(
            EdgewiseVault.Mandate(agent, block.timestamp + 1 days, 2000e18, 100e6, 500e6, 10000, 100, 0, 0, policy)
        );
    }

    function testReal50USDTTrade() public {
        uint256 refOut = _ref(50e6);
        uint256 minOut = refOut * 99 / 100;
        bytes32 hash = keccak256("fork receipt");
        EdgewiseVault.TradeParams memory p =
            EdgewiseVault.TradeParams(
            Addresses.USDT_177, 50e6, minOut, block.timestamp, block.timestamp + 60, v.nextNonce(), hash, 0, ReceiptChain.Kind.TRADE
        );
        vm.recordLogs();
        vm.prank(agent);
        uint256 start = gasleft();
        uint256 out = v.trade(p);
        uint256 used = start - gasleft();
        console2.log("Fork trade() measured gas (call including external swap):", used);
        assertGe(out, minOut);
        assertEq(IERC20(Addresses.USDT_177).balanceOf(address(v)), 950e6);
        assertEq(IERC20(Addresses.WHSK_177).balanceOf(address(v)), out);
        assertEq(IERC20(Addresses.USDT_177).allowance(address(v), Addresses.SWAPROUTER02_177), 0);
        assertEq(v.seq(), 1);
        assertEq(v.head(), keccak256(abi.encode(bytes32(0), hash, uint64(0))));
        _assertReceipt(hash, out, minOut, refOut);
    }

    function _assertReceipt(bytes32 hash, uint256 out, uint256 minOut, uint256 refOut) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(v)) {
                assertEq(
                    logs[i].topics[0],
                    keccak256("Receipt(uint64,bytes32,bytes32,bytes32,uint8,address,uint256,uint256,uint256,uint256)")
                );
                assertEq(logs[i].topics[1], bytes32(0));
                assertEq(logs[i].topics[2], hash);
                assertEq(
                    logs[i].data,
                    abi.encode(bytes32(0), policy, uint8(0), Addresses.USDT_177, uint256(50e6), out, minOut, refOut)
                );
                found = true;
            }
        }
        assertTrue(found, "Receipt missing");
    }

    function testRealOracleStaleFailsClosedWhenCallable() public {
        if (feed == address(0)) {
            console2.log("SKIP: APRO rejects contracts; freshness verified with MockAggregator");
            vm.skip(true);
        }
        (,,, uint256 updated,) = IAggregatorV3(feed).latestRoundData();
        v = _vault(0);
        _fund(address(v), 1000e6);
        vm.warp(block.timestamp > updated ? block.timestamp : updated + 1);
        EdgewiseVault.TradeParams memory p = EdgewiseVault.TradeParams(
            Addresses.USDT_177,
            50e6,
            _ref(50e6) * 99 / 100,
            block.timestamp,
            block.timestamp + 60,
            v.nextNonce(),
            keccak256("stale"),
            0,
            ReceiptChain.Kind.TRADE
        );
        vm.prank(agent);
        vm.expectRevert(EdgewiseVault.OracleInvalid.selector);
        v.trade(p);
    }
}
