// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {TickMath} from "../../src/lib/TickMath.sol";
import {FullMath} from "../../src/lib/FullMath.sol";
import {SafeToken} from "../../src/lib/SafeToken.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";

contract EdgewiseVaultTest is Test {
    EdgewiseVault v;
    MockERC20 a;
    MockERC20 b;
    MockRouter router;
    MockPool pool;
    MockAggregator oracle;
    address agent;
    address stranger;
    EdgewiseVault.Mandate m;

    function setUp() public {
        vm.warp(10 days);
        agent = makeAddr("agent");
        stranger = makeAddr("stranger");
        a = new MockERC20(18);
        b = new MockERC20(18);
        router = new MockRouter();
        pool = new MockPool(address(a), address(b));
        oracle = new MockAggregator();
        v = _deploy(address(0), 1 hours);
        m = EdgewiseVault.Mandate(
            agent, block.timestamp + 30 days, 100e18, 100e18, 150e18, 10000, 100, 0, keccak256("policy")
        );
        v.setMandate(m);
        a.mint(address(v), 1000e18);
        b.mint(address(v), 1000e18);
        a.mint(address(router), 10000e18);
        b.mint(address(router), 10000e18);
    }

    function _deploy(address feed, uint256 age) internal returns (EdgewiseVault) {
        return new EdgewiseVault(
            address(this), address(router), address(pool), address(a), address(b), 3000, 300, feed, 500, age
        );
    }

    function _params() internal view returns (EdgewiseVault.TradeParams memory) {
        return EdgewiseVault.TradeParams(
            address(b),
            50e18,
            49.5e18,
            block.timestamp,
            block.timestamp + 60, // validUntil added
            v.nextNonce(),
            keccak256("trade"),
            v.head(),
            ReceiptChain.Kind.TRADE
        );
    }

    function _trade() internal returns (uint256) {
        EdgewiseVault.TradeParams memory p = _params();
        vm.prank(agent);
        return v.trade(p);
    }

    function _reject(EdgewiseVault.TradeParams memory p, bytes4 err) internal {
        vm.prank(agent);
        vm.expectRevert(err);
        v.trade(p);
        assertEq(b.allowance(address(v), address(router)), 0);
    }

    function testTradeReceiptAndBalances() public {
        EdgewiseVault.TradeParams memory p = _params();
        vm.expectEmit(true, true, false, true, address(v));
        emit ReceiptChain.Receipt(0, p.receiptHash, 0, m.policyHash, 0, address(b), 50e18, 50e18, 49.5e18, 50e18);
        assertEq(_trade(), 50e18);
        assertEq(v.seq(), 1);
        assertEq(v.nextNonce(), 1);
        assertEq(v.head(), keccak256(abi.encode(bytes32(0), p.receiptHash, uint64(0))));
        assertEq(a.balanceOf(address(v)), 1050e18);
        assertEq(b.balanceOf(address(v)), 950e18);
        assertEq(b.allowance(address(v), address(router)), 0);
    }

    function testDeriskAboveCap() public {
        m.maxExposureBps = 4000;
        v.setMandate(m);
        EdgewiseVault.TradeParams memory p = _params();
        p.tokenIn = address(a);
        vm.prank(agent);
        v.trade(p); // 50% -> 47.5%, still above 40%.
        assertEq(a.balanceOf(address(v)), 950e18);
        assertEq(a.allowance(address(v), address(router)), 0);
        assertEq(v.seq(), 1);
    }

    function testIncreasingExposureWithinCap() public {
        m.maxExposureBps = 5300;
        v.setMandate(m);
        _trade(); // 50% -> 52.5% <= 53%.
        assertEq(v.seq(), 1);
    }

    function testIncreasingExposureAboveCapReverts() public {
        m.maxExposureBps = 5100;
        v.setMandate(m);
        _reject(_params(), EdgewiseVault.Exposure.selector);
        assertEq(v.seq(), 0);
        assertEq(v.nextNonce(), 0);
    }

    function testSellAResize() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.tokenIn = address(a);
        p.kind = ReceiptChain.Kind.RESIZE;
        vm.prank(agent);
        v.trade(p);
        assertEq(a.allowance(address(v), address(router)), 0);
        assertEq(v.dailyNotionalB(), 50e18);
    }

    function testNonOwnerSetMandate() public {
        vm.prank(stranger);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        v.setMandate(m);
    }

    function testNonOwnerRevoke() public {
        vm.prank(stranger);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        v.revoke();
    }

    function testNonOwnerWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        v.withdraw(address(b), 1, stranger);
    }

    function testNonOwnerPause() public {
        vm.prank(stranger);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        v.pause();
    }

    function testNonOwnerUnpause() public {
        vm.prank(stranger);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        v.unpause();
    }

    function testAgentOwnerRejected() public {
        m.agent = address(this);
        vm.expectRevert(EdgewiseVault.InvalidMandate.selector);
        v.setMandate(m);
    }

    function testZeroAgentRejected() public {
        m.agent = address(0);
        vm.expectRevert(EdgewiseVault.InvalidMandate.selector);
        v.setMandate(m);
    }

    function testSlippage101Rejected() public {
        m.maxSlippageBps = 101;
        vm.expectRevert(EdgewiseVault.InvalidMandate.selector);
        v.setMandate(m);
    }

    function testExpiredMandateSet() public {
        m.expiry = block.timestamp;
        vm.expectRevert(EdgewiseVault.InvalidMandate.selector);
        v.setMandate(m);
    }

    function testInvalidExposureMandate() public {
        m.maxExposureBps = 10001;
        vm.expectRevert(EdgewiseVault.InvalidMandate.selector);
        v.setMandate(m);
    }

    function testExpiredMandate() public {
        vm.warp(m.expiry);
        _reject(_params(), EdgewiseVault.Inactive.selector);
    }

    function testAfterRevoke() public {
        v.revoke();
        _reject(_params(), EdgewiseVault.Unauthorized.selector);
    }

    function testPaused() public {
        v.pause();
        _reject(_params(), EdgewiseVault.Inactive.selector);
    }

    function testUnpause() public {
        v.pause();
        v.unpause();
        _trade();
    }

    function testWrongAgent() public {
        EdgewiseVault.TradeParams memory p = _params();
        vm.prank(stranger);
        vm.expectRevert(EdgewiseVault.Unauthorized.selector);
        v.trade(p);
    }

    function testDeadlinePassed() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.deadline--;
        _reject(p, EdgewiseVault.Deadline.selector);
    }

    function testValidUntilExpired() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.validUntil = block.timestamp - 1;
        _reject(p, EdgewiseVault.DecisionExpired.selector);
    }

    function testValidUntilBoundary() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.validUntil = block.timestamp;
        vm.prank(agent);
        v.trade(p);
        assertEq(v.seq(), 1);
    }

    function testValidUntilValid() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.validUntil = block.timestamp + 30;
        vm.prank(agent);
        v.trade(p);
        assertEq(v.seq(), 1);
    }

    function testNonceReplay() public {
        _trade();
        EdgewiseVault.TradeParams memory p = _params();
        p.nonce = 0;
        _reject(p, EdgewiseVault.Nonce.selector);
    }

    function testNonceSkip() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.nonce = 1;
        _reject(p, EdgewiseVault.Nonce.selector);
    }

    function testMinInterval() public {
        m.minIntervalSec = 60;
        v.setMandate(m);
        _trade();
        _reject(_params(), EdgewiseVault.Interval.selector);
    }

    function testIntervalBoundary() public {
        m.minIntervalSec = 60;
        v.setMandate(m);
        _trade();
        vm.warp(block.timestamp + 60);
        _trade();
    }

    function testPerTradeCapB() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.amountIn = 101e18;
        _reject(p, EdgewiseVault.TradeCap.selector);
    }

    function testPerTradeCapA() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.tokenIn = address(a);
        p.amountIn = 101e18;
        _reject(p, EdgewiseVault.TradeCap.selector);
    }

    function testZeroAmount() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.amountIn = 0;
        _reject(p, EdgewiseVault.TradeCap.selector);
    }

    function testDailyCapAcrossTwoTrades() public {
        m.maxDailyInB = 99e18;
        v.setMandate(m);
        _trade();
        _reject(_params(), EdgewiseVault.DailyCap.selector);
        assertEq(v.dailyNotionalB(), 50e18);
        assertEq(v.seq(), 1);
    }

    function testDailyBucketReset() public {
        m.maxDailyInB = 50e18;
        v.setMandate(m);
        _trade();
        vm.warp(block.timestamp + 1 days);
        _trade();
        assertEq(v.dailyNotionalB(), 50e18);
    }

    function testMandateChangePreservesDailyCap() public {
        _trade();
        m.maxDailyInB = 99e18;
        v.setMandate(m);
        _reject(_params(), EdgewiseVault.DailyCap.selector);
    }

    function testExposureExceeded() public {
        m.maxExposureBps = 5000;
        v.setMandate(m);
        _reject(_params(), EdgewiseVault.Exposure.selector);
        assertEq(v.seq(), 0);
        assertEq(v.nextNonce(), 0);
        assertEq(a.balanceOf(address(v)), 1000e18);
    }

    function testMinOutBelowFloor() public {
        EdgewiseVault.TradeParams memory p = _params();
        // Ensure validUntil is still in future for this test
        // (already set in _params)
        p.minOut--;
        _reject(p, EdgewiseVault.Slippage.selector);
    }

    function testRouterUnderfill() public {
        router.setUnderfill(true);
        _reject(_params(), EdgewiseVault.Underfill.selector);
        assertEq(v.nextNonce(), 0);
    }

    function testPrevHeadTradeMismatch() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.prevHead = bytes32(uint256(1));
        _reject(p, ReceiptChain.PreviousHead.selector);
    }

    function testPrevHeadHoldMismatch() public {
        vm.prank(agent);
        vm.expectRevert(ReceiptChain.PreviousHead.selector);
        v.commitHold(0, bytes32(uint256(1)), ReceiptChain.Kind.WAIT);
    }

    function testHoldTradeRejected() public {
        vm.prank(agent);
        vm.expectRevert(ReceiptChain.InvalidKind.selector);
        v.commitHold(0, 0, ReceiptChain.Kind.TRADE);
    }

    function testHoldResizeRejected() public {
        vm.prank(agent);
        vm.expectRevert(ReceiptChain.InvalidKind.selector);
        v.commitHold(0, 0, ReceiptChain.Kind.RESIZE);
    }

    function testTradeWaitRejected() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.kind = ReceiptChain.Kind.WAIT;
        _reject(p, ReceiptChain.InvalidKind.selector);
    }

    function testTokenNotPair() public {
        EdgewiseVault.TradeParams memory p = _params();
        p.tokenIn = stranger;
        _reject(p, EdgewiseVault.InvalidToken.selector);
    }

    function testObserveRevert() public {
        pool.setFail(true);
        EdgewiseVault.TradeParams memory p = _params();
        vm.prank(agent);
        vm.expectRevert("observe failed");
        v.trade(p);
    }

    function testHoldFieldsAndNoFunds() public {
        bytes32 hash = keccak256("hold");
        vm.expectEmit(true, true, false, true, address(v));
        emit ReceiptChain.Receipt(0, hash, 0, m.policyHash, 2, address(0), 0, 0, 0, 0);
        vm.prank(agent);
        v.commitHold(hash, 0, ReceiptChain.Kind.WAIT);
        bytes32 prev = v.head();
        vm.prank(agent);
        v.commitHold(hash, prev, ReceiptChain.Kind.REJECT);
        assertEq(v.seq(), 2);
        assertEq(v.nextNonce(), 0);
        assertEq(a.balanceOf(address(v)), 1000e18);
    }

    function testHoldExpired() public {
        vm.warp(m.expiry);
        vm.prank(agent);
        vm.expectRevert(EdgewiseVault.Inactive.selector);
        v.commitHold(0, 0, ReceiptChain.Kind.WAIT);
    }

    function testWithdraw() public {
        v.withdraw(address(b), 10e18, stranger);
        assertEq(b.balanceOf(stranger), 10e18);
    }

    function testDeposit() public {
        b.mint(address(this), 10e18);
        b.approve(address(v), 10e18);
        v.deposit(address(b), 10e18);
        assertEq(b.balanceOf(address(v)), 1010e18);
        assertEq(b.allowance(address(this), address(v)), 0);
    }

    function testDepositWrongToken() public {
        vm.expectRevert(EdgewiseVault.InvalidToken.selector);
        v.deposit(stranger, 1);
    }

    function testFalseTokenReturn() public {
        b.configure(true, false, false);
        vm.expectRevert(SafeToken.TokenCall.selector);
        v.withdraw(address(b), 1, stranger);
    }

    function testFeeOnTransferDeposit() public {
        b.mint(address(this), 100);
        b.approve(address(v), 100);
        b.configure(false, true, false);
        vm.expectRevert(SafeToken.InexactTransfer.selector);
        v.deposit(address(b), 100);
    }

    function testUSDTResetApproval() public {
        b.configure(false, false, true);
        _trade();
        _trade();
        assertEq(b.allowance(address(v), address(router)), 0);
    }

    function testOracleFresh() public {
        v = _deploy(address(oracle), 3600);
        v.setMandate(m);
        b.mint(address(v), 100e18);
        _trade();
    }

    function _oracleVault() internal {
        v = _deploy(address(oracle), 1);
        v.setMandate(m);
        b.mint(address(v), 100e18);
    }

    function testOracleMaxAgeFailClosed() public {
        _oracleVault();
        vm.warp(block.timestamp + 2);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleNegative() public {
        _oracleVault();
        oracle.set(-1, block.timestamp, 1, 1);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleZeroTime() public {
        _oracleVault();
        oracle.set(1e8, 0, 1, 1);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleFuture() public {
        _oracleVault();
        oracle.set(1e8, block.timestamp + 1, 1, 1);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleIncompleteRound() public {
        _oracleVault();
        oracle.set(1e8, block.timestamp, 2, 1);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleBandHigh() public {
        _oracleVault();
        oracle.set(2e8, block.timestamp, 1, 1);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleBandLow() public {
        _oracleVault();
        oracle.set(5e7, block.timestamp, 1, 1);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleBadDecimals() public {
        _oracleVault();
        oracle.setDecimals(39);
        _reject(_params(), EdgewiseVault.OracleInvalid.selector);
    }

    function testOracleRevert() public {
        _oracleVault();
        oracle.setFail(true);
        EdgewiseVault.TradeParams memory p = _params();
        vm.prank(agent);
        vm.expectRevert("oracle failed");
        v.trade(p);
    }

    function testConstructorZeroOwner() public {
        vm.expectRevert(EdgewiseVault.InvalidConfig.selector);
        new EdgewiseVault(
            address(0), address(router), address(pool), address(a), address(b), 3000, 300, address(0), 0, 0
        );
    }

    function testConstructorWrongFee() public {
        vm.expectRevert(EdgewiseVault.InvalidConfig.selector);
        new EdgewiseVault(
            address(this), address(router), address(pool), address(a), address(b), 500, 300, address(0), 0, 0
        );
    }

    function testConstructorWrongPair() public {
        vm.expectRevert(EdgewiseVault.InvalidConfig.selector);
        new EdgewiseVault(
            address(this), address(router), address(pool), address(b), address(router), 3000, 300, address(0), 0, 0
        );
    }

    function testConstructorBadDecimals() public {
        MockERC20 c = new MockERC20(39);
        MockPool p = new MockPool(address(c), address(b));
        vm.expectRevert(EdgewiseVault.InvalidConfig.selector);
        new EdgewiseVault(
            address(this), address(router), address(p), address(c), address(b), 3000, 300, address(0), 0, 0
        );
    }

    function testNegativeFractionalTickRoundsDown() public {
        pool.setTick(0, -1); // -1/300 must round down to tick -1, not tick zero.
        uint256 sqrt = TickMath.getSqrtRatioAtTick(-1);
        uint256 ratio = sqrt * sqrt;
        uint256 expected =
            address(b) < address(a) ? FullMath.mulDiv(ratio, 50e18, 1 << 192) : FullMath.mulDiv(1 << 192, 50e18, ratio);
        router.setPrice(expected, 50e18);
        EdgewiseVault.TradeParams memory p = _params();
        p.minOut = expected * 99 / 100;
        vm.expectEmit(true, true, false, true, address(v));
        emit ReceiptChain.Receipt(0, p.receiptHash, 0, m.policyHash, 0, address(b), 50e18, expected, p.minOut, expected);
        vm.prank(agent);
        v.trade(p);
    }

    function testHighSqrtPriceBothDirections() public {
        pool.setTick(500000, 0); // Exercises the 128-bit ratio path in both directions.
        uint160 sqrt = TickMath.getSqrtRatioAtTick(500000);
        uint256 ratio = FullMath.mulDiv(sqrt, sqrt, 1 << 64);
        m.maxTradeInA = 1e60;
        m.maxTradeInB = 1e60;
        m.maxDailyInB = 1e60;
        v.setMandate(m);
        a.mint(address(v), 1e60);
        b.mint(address(v), 1e60);
        a.mint(address(router), 1e60);
        b.mint(address(router), 1e60);
        for (uint256 j; j < 2; ++j) {
            address input = j == 0 ? address(a) : address(b);
            uint256 amount = 1e30;
            uint256 expected = input < (j == 0 ? address(b) : address(a))
                ? FullMath.mulDiv(ratio, amount, 1 << 128)
                : FullMath.mulDiv(1 << 128, amount, ratio);
            router.setPrice(expected, amount);
            EdgewiseVault.TradeParams memory p = _params();
            p.tokenIn = input;
            p.amountIn = amount;
            p.minOut = expected * 99 / 100;
            vm.prank(agent);
            assertEq(v.trade(p), expected);
            assertEq(MockERC20(input).allowance(address(v), address(router)), 0);
        }
    }

    function testInvalidObservedTickFailsClosed() public {
        pool.setTick(887273, 0);
        _reject(_params(), EdgewiseVault.InvalidConfig.selector);
    }

    function testZeroReferenceFailsClosed() public {
        pool.setTick(address(b) < address(a) ? int24(-887272) : int24(887272), 0);
        EdgewiseVault.TradeParams memory p = _params();
        p.amountIn = 1;
        p.minOut = 0;
        _reject(p, EdgewiseVault.Slippage.selector);
    }

    function testVaultReentrantDepositRejected() public {
        router.setCallback(address(v), abi.encodeCall(v.deposit, (address(b), 0)));
        EdgewiseVault.TradeParams memory p = _params();
        vm.prank(agent);
        vm.expectRevert("callback failed");
        v.trade(p);
        assertEq(v.seq(), 0);
        assertEq(v.nextNonce(), 0);
    }

    function testMandateSetEvent() public {
        vm.expectEmit(false, false, false, true, address(v));
        emit EdgewiseVault.MandateSet(m);
        v.setMandate(m);
    }

    function testSixDecimalOracleScaling() public {
        b = new MockERC20(6);
        pool = new MockPool(address(a), address(b));
        // Tick zero means equal RAW units: one 18-decimal A is 1e12 whole B.
        oracle.set(1e20, block.timestamp, 1, 1);
        v = _deploy(address(oracle), 3600);
        m.maxTradeInB = 100e6;
        m.maxDailyInB = 200e6;
        v.setMandate(m);
        b.mint(address(v), 100e6);
        a.mint(address(router), 100e6);
        EdgewiseVault.TradeParams memory p = _params();
        p.amountIn = 50e6;
        p.minOut = 49_500_000;
        vm.prank(agent);
        assertEq(v.trade(p), 50e6);
    }

    function testFuzzAmountsAndChain(uint96 x, uint8 count) public {
        uint256 n = bound(count, 1, 5);
        uint256 amount = bound(x, 1e6, 20e18);
        bytes32 prev;
        for (uint64 i; i < n; ++i) {
            EdgewiseVault.TradeParams memory p = _params();
            p.amountIn = amount;
            p.minOut = amount * 99 / 100;
            p.receiptHash = keccak256(abi.encode(x, i));
            vm.prank(agent);
            v.trade(p);
            prev = keccak256(abi.encode(prev, p.receiptHash, i));
            assertEq(v.head(), prev);
            assertEq(v.seq(), i + 1);
            assertEq(v.nextNonce(), i + 1);
            assertEq(b.allowance(address(v), address(router)), 0);
        }
    }
}
