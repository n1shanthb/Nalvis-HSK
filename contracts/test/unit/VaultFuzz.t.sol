// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockPool} from "../mocks/MockPool.sol";

contract VaultFuzzTest is Test {
    EdgewiseVault internal vault;
    MockERC20 internal a;
    MockERC20 internal b;
    MockRouter internal router;
    MockPool internal pool;

    address internal agent;
    address internal stranger;

    function setUp() public {
        vm.warp(10 days);
        agent = makeAddr("fuzz_agent");
        stranger = makeAddr("fuzz_stranger");

        a = new MockERC20(18);
        b = new MockERC20(18);
        router = new MockRouter();
        pool = new MockPool(address(a), address(b));

        vault = new EdgewiseVault(
            address(this),
            address(router),
            address(pool),
            address(a),
            address(b),
            3000,
            300,
            address(0),
            500,
            1 hours
        );

        EdgewiseVault.Mandate memory m = EdgewiseVault.Mandate({
            agent: agent,
            expiry: block.timestamp + 30 days,
            maxTradeInA: 100e18,
            maxTradeInB: 100e18,
            maxDailyInB: 200e18,
            maxExposureBps: 10000,
            maxSlippageBps: 100,
            minIntervalSec: 60,
            maxDrawdownBps: 2000,
            policyHash: keccak256("fuzz_policy")
        });
        vault.setMandate(m);

        a.mint(address(vault), 1000e18);
        b.mint(address(vault), 1000e18);
        a.mint(address(router), 10000e18);
        b.mint(address(router), 10000e18);
    }

    /// @notice Fuzz test: any maxSlippageBps > 100 MUST revert with InvalidMandate()
    function testFuzz_MandateSlippageCap(uint16 slippageBps) public {
        EdgewiseVault.Mandate memory m = vault.getMandate();
        m.maxSlippageBps = slippageBps;

        if (slippageBps > 100) {
            vm.expectRevert(EdgewiseVault.InvalidMandate.selector);
            vault.setMandate(m);
        } else {
            vault.setMandate(m);
            EdgewiseVault.Mandate memory after_ = vault.getMandate();
            assertEq(after_.maxSlippageBps, slippageBps);
        }
    }

    /// @notice Fuzz test: any maxDrawdownBps > 10_000 MUST revert with InvalidMandate()
    function testFuzz_MandateDrawdownCap(uint16 drawdownBps) public {
        EdgewiseVault.Mandate memory m = vault.getMandate();
        m.maxDrawdownBps = drawdownBps;

        if (drawdownBps > 10000) {
            vm.expectRevert(EdgewiseVault.InvalidMandate.selector);
            vault.setMandate(m);
        } else {
            vault.setMandate(m);
            EdgewiseVault.Mandate memory after_ = vault.getMandate();
            assertEq(after_.maxDrawdownBps, drawdownBps);
        }
    }

    /// @notice Fuzz test: decision expiry guardrail
    function testFuzz_DecisionExpiry(uint256 validUntilDelta) public {
        // Delta between 1 second and 1 day in the past vs future
        validUntilDelta = bound(validUntilDelta, 1, 1 days);

        // Case 1: validUntil in the past
        uint256 expiredTime = block.timestamp - validUntilDelta;
        EdgewiseVault.TradeParams memory pExpired = EdgewiseVault.TradeParams({
            tokenIn: address(b),
            amountIn: 10e18,
            minOut: 9.9e18,
            deadline: block.timestamp + 300,
            validUntil: expiredTime,
            nonce: vault.nextNonce(),
            receiptHash: keccak256("exp"),
            prevHead: vault.head(),
            kind: ReceiptChain.Kind.TRADE
        });

        vm.prank(agent);
        vm.expectRevert(EdgewiseVault.DecisionExpired.selector);
        vault.trade(pExpired);

        // Case 2: validUntil in the future or exact boundary
        uint256 validTime = block.timestamp + validUntilDelta;
        EdgewiseVault.TradeParams memory pValid = EdgewiseVault.TradeParams({
            tokenIn: address(b),
            amountIn: 10e18,
            minOut: 9.9e18,
            deadline: block.timestamp + 300,
            validUntil: validTime,
            nonce: vault.nextNonce(),
            receiptHash: keccak256("valid"),
            prevHead: vault.head(),
            kind: ReceiptChain.Kind.TRADE
        });

        vm.prank(agent);
        uint256 out = vault.trade(pValid);
        assertGe(out, 9.9e18);
    }

    /// @notice Fuzz test: per-trade cap enforcement
    function testFuzz_PerTradeCap(uint256 amountIn) public {
        amountIn = bound(amountIn, 1e18, 500e18);

        EdgewiseVault.TradeParams memory p = EdgewiseVault.TradeParams({
            tokenIn: address(b),
            amountIn: amountIn,
            minOut: (amountIn * 99) / 100,
            deadline: block.timestamp + 300,
            validUntil: block.timestamp + 60,
            nonce: vault.nextNonce(),
            receiptHash: keccak256(abi.encodePacked("trade_cap", amountIn)),
            prevHead: vault.head(),
            kind: ReceiptChain.Kind.TRADE
        });

        EdgewiseVault.Mandate memory _m = vault.getMandate();
        vm.prank(agent);
        if (amountIn > _m.maxTradeInB) {
            vm.expectRevert(EdgewiseVault.TradeCap.selector);
            vault.trade(p);
        } else {
            uint256 out = vault.trade(p);
            assertGe(out, p.minOut);
        }
    }

    /// @notice Fuzz test: min interval enforcement
    function testFuzz_MinInterval(uint256 intervalDelta) public {
        intervalDelta = bound(intervalDelta, 0, 120);

        // First trade
        EdgewiseVault.TradeParams memory p1 = EdgewiseVault.TradeParams({
            tokenIn: address(b),
            amountIn: 10e18,
            minOut: 9.9e18,
            deadline: block.timestamp + 300,
            validUntil: block.timestamp + 60,
            nonce: vault.nextNonce(),
            receiptHash: keccak256("trade1"),
            prevHead: vault.head(),
            kind: ReceiptChain.Kind.TRADE
        });

        vm.prank(agent);
        vault.trade(p1);

        // Warp by intervalDelta
        vm.warp(block.timestamp + intervalDelta);

        EdgewiseVault.TradeParams memory p2 = EdgewiseVault.TradeParams({
            tokenIn: address(b),
            amountIn: 10e18,
            minOut: 9.9e18,
            deadline: block.timestamp + 300,
            validUntil: block.timestamp + 60,
            nonce: vault.nextNonce(),
            receiptHash: keccak256("trade2"),
            prevHead: vault.head(),
            kind: ReceiptChain.Kind.TRADE
        });

        EdgewiseVault.Mandate memory _m2 = vault.getMandate();
        vm.prank(agent);
        if (intervalDelta < _m2.minIntervalSec) {
            vm.expectRevert(EdgewiseVault.Interval.selector);
            vault.trade(p2);
        } else {
            uint256 out = vault.trade(p2);
            assertGe(out, p2.minOut);
        }
    }

    /// @notice Fuzz test: agent can NEVER withdraw or transfer tokens
    function testFuzz_AgentCannotWithdraw(address recipient, uint256 amount) public {
        vm.assume(recipient != address(0));
        amount = bound(amount, 1, 1000e18);

        vm.prank(agent);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        vault.withdraw(address(a), amount, recipient);

        vm.prank(agent);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        vault.withdraw(address(b), amount, recipient);
    }
}
