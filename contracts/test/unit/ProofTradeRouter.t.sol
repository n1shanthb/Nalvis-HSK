// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {ProofTradeRouter} from "../../src/ProofTradeRouter.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {IV3SwapRouter} from "../../src/interfaces/IV3SwapRouter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockRouter} from "../mocks/MockRouter.sol";

contract ProofTradeRouterTest is Test {
    ProofTradeRouter r;
    MockRouter router;
    MockERC20 a;
    MockERC20 b;
    address alice;
    address bob;

    function setUp() public {
        vm.warp(10 days);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        a = new MockERC20(6);
        b = new MockERC20(18);
        router = new MockRouter();
        router.setPrice(1e12, 1);
        r = new ProofTradeRouter(address(this), address(router));
        r.setPolicy(keccak256("policy"));
        a.mint(alice, 1000e6);
        a.mint(bob, 1000e6);
        b.mint(address(router), 10000e18);
        vm.prank(alice);
        a.approve(address(r), 1000e6);
        vm.prank(bob);
        a.approve(address(r), 1000e6);
    }

    function _params(address caller, uint256 amount)
        internal
        view
        returns (IV3SwapRouter.ExactInputSingleParams memory)
    {
        return IV3SwapRouter.ExactInputSingleParams(address(a), address(b), 3000, caller, amount, amount * 1e12, 0);
    }

    function testSwapReceipt() public {
        bytes32 hash = keccak256("receipt");
        vm.expectEmit(true, true, false, true, address(r));
        emit ReceiptChain.Receipt(0, hash, 0, keccak256("policy"), 0, address(a), 50e6, 50e18, 50e18, 0);
        vm.prank(alice);
        r.commitAndSwap(hash, 0, _params(alice, 50e6), block.timestamp);
        assertEq(a.balanceOf(alice), 950e6);
        assertEq(b.balanceOf(alice), 50e18);
        assertEq(a.balanceOf(address(r)), 0);
        assertEq(a.allowance(address(r), address(router)), 0);
        assertEq(r.seq(alice), 1);
        assertEq(r.head(alice), keccak256(abi.encode(bytes32(0), hash, uint64(0))));
    }

    function testRecipientMismatch() public {
        vm.prank(alice);
        vm.expectRevert(ProofTradeRouter.Recipient.selector);
        r.commitAndSwap(0, 0, _params(bob, 50e6), block.timestamp);
    }

    function testDeadlinePassed() public {
        vm.prank(alice);
        vm.expectRevert(ProofTradeRouter.Deadline.selector);
        r.commitAndSwap(0, 0, _params(alice, 50e6), block.timestamp - 1);
    }

    function testSetPolicyNonOwner() public {
        vm.prank(bob);
        vm.expectRevert(ProofTradeRouter.Unauthorized.selector);
        r.setPolicy(0);
    }

    function testSetPolicyOwner() public {
        r.setPolicy(bytes32(uint256(7)));
        assertEq(r.policyHash(), bytes32(uint256(7)));
    }

    function testUnderfill() public {
        router.setUnderfill(true);
        vm.prank(alice);
        vm.expectRevert(ProofTradeRouter.Underfill.selector);
        r.commitAndSwap(0, 0, _params(alice, 50e6), block.timestamp);
        assertEq(r.seq(alice), 0);
        assertEq(a.balanceOf(alice), 1000e6);
        assertEq(a.allowance(address(r), address(router)), 0);
    }

    function testPrevHeadSwapMismatch() public {
        vm.prank(alice);
        vm.expectRevert(ReceiptChain.PreviousHead.selector);
        r.commitAndSwap(0, bytes32(uint256(1)), _params(alice, 50e6), block.timestamp);
    }

    function testPrevHeadHoldMismatch() public {
        vm.prank(alice);
        vm.expectRevert(ReceiptChain.PreviousHead.selector);
        r.commitHold(0, bytes32(uint256(1)), ReceiptChain.Kind.WAIT);
    }

    function testHoldTradeRejected() public {
        vm.prank(alice);
        vm.expectRevert(ReceiptChain.InvalidKind.selector);
        r.commitHold(0, 0, ReceiptChain.Kind.TRADE);
    }

    function testHoldAndCallerIsolation() public {
        bytes32 hash = keccak256("hold");
        vm.expectEmit(true, true, false, true, address(r));
        emit ReceiptChain.Receipt(0, hash, 0, keccak256("policy"), 3, address(0), 0, 0, 0, 0);
        vm.prank(alice);
        r.commitHold(hash, 0, ReceiptChain.Kind.REJECT);
        vm.prank(bob);
        r.commitHold(hash, 0, ReceiptChain.Kind.WAIT);
        assertEq(r.seq(alice), 1);
        assertEq(r.seq(bob), 1);
        bytes32 prev = r.head(alice);
        vm.prank(alice);
        r.commitAndSwap(hash, prev, _params(alice, 50e6), block.timestamp);
        assertEq(r.seq(alice), 2);
        assertEq(r.seq(bob), 1);
        assertEq(r.head(bob), prev);
        assertEq(a.balanceOf(bob), 1000e6);
    }

    function testConstructorInvalidOwner() public {
        vm.expectRevert(ProofTradeRouter.InvalidOwner.selector);
        new ProofTradeRouter(address(0), address(router));
    }

    function testConstructorInvalidRouter() public {
        vm.expectRevert(ProofTradeRouter.InvalidOwner.selector);
        new ProofTradeRouter(address(this), bob);
    }

    function testReentrancy() public {
        router.setCallback(address(r), abi.encodeCall(r.commitHold, (bytes32(0), bytes32(0), ReceiptChain.Kind.WAIT)));
        vm.prank(alice);
        vm.expectRevert("callback failed");
        r.commitAndSwap(0, 0, _params(alice, 50e6), block.timestamp);
        assertEq(r.seq(alice), 0);
        assertEq(a.balanceOf(alice), 1000e6);
    }

    function testFuzzAmountsAndChains(uint96 x, uint8 count) public {
        uint256 amount = bound(x, 1, 100e6);
        uint256 n = bound(count, 1, 5);
        bytes32 prev;
        for (uint64 i; i < n; ++i) {
            bytes32 hash = keccak256(abi.encode(x, i));
            vm.prank(alice);
            r.commitAndSwap(hash, prev, _params(alice, amount), block.timestamp);
            prev = keccak256(abi.encode(prev, hash, i));
            assertEq(r.head(alice), prev);
            assertEq(r.seq(alice), i + 1);
            assertEq(a.allowance(address(r), address(router)), 0);
            assertEq(r.seq(bob), 0);
        }
    }
}
