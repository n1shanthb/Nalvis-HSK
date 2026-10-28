// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";

contract ReceiptHarness is ReceiptChain {
    Chain private chain;

    function seq() external view returns (uint64) {
        return chain.seq;
    }

    function head() external view returns (bytes32) {
        return chain.head;
    }

    function commit(bytes32 hash, bytes32 prev, Kind kind) external {
        _commit(chain, hash, prev, bytes32(uint256(9)), kind, Fill(address(0), 0, 0, 0, 0));
    }
}

contract ReceiptChainTest is Test {
    ReceiptHarness h;

    function setUp() public {
        h = new ReceiptHarness();
    }

    function testInitialState() public view {
        assertEq(h.seq(), 0);
        assertEq(h.head(), bytes32(0));
    }

    function testReceiptFieldsAndOrder() public {
        bytes32 hash = keccak256("receipt");
        vm.expectEmit(true, true, false, true, address(h));
        emit ReceiptChain.Receipt(0, hash, 0, bytes32(uint256(9)), 2, address(0), 0, 0, 0, 0);
        h.commit(hash, 0, ReceiptChain.Kind.WAIT);
        assertEq(h.seq(), 1);
        assertEq(h.head(), keccak256(abi.encode(bytes32(0), hash, uint64(0))));
        bytes32 prev = h.head();
        h.commit(hash, prev, ReceiptChain.Kind.REJECT);
        assertEq(h.seq(), 2);
        assertEq(h.head(), keccak256(abi.encode(prev, hash, uint64(1))));
    }

    function testPrevHeadMismatch() public {
        vm.expectRevert(ReceiptChain.PreviousHead.selector);
        h.commit(0, bytes32(uint256(1)), ReceiptChain.Kind.WAIT);
        assertEq(h.seq(), 0);
    }

    function testFuzzChain(bytes32 seed, uint8 count) public {
        uint256 n = bound(count, 1, 40);
        bytes32 prev;
        for (uint64 i; i < n; ++i) {
            bytes32 hash = keccak256(abi.encode(seed, i));
            h.commit(hash, prev, ReceiptChain.Kind.WAIT);
            prev = keccak256(abi.encode(prev, hash, i));
            assertEq(h.head(), prev);
            assertEq(h.seq(), i + 1);
        }
    }
}
