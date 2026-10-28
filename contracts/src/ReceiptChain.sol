// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Append-only decision commitments. Sequence numbers start at zero.
abstract contract ReceiptChain {
    enum Kind {
        TRADE,
        RESIZE,
        WAIT,
        REJECT
    }

    struct Chain {
        uint64 seq;
        bytes32 head;
    }

    struct Fill {
        address tokenIn;
        uint256 amountIn;
        uint256 amountOut;
        uint256 minOut;
        uint256 refOut;
    }
    error PreviousHead();
    error InvalidKind();
    event Receipt(
        uint64 indexed seq,
        bytes32 indexed receiptHash,
        bytes32 prevHead,
        bytes32 policyHash,
        uint8 kind,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minOut,
        uint256 refOut
    );

    function _commit(
        Chain storage chain,
        bytes32 receiptHash,
        bytes32 prevHead,
        bytes32 policyHash,
        Kind kind,
        Fill memory fill
    ) internal {
        if (prevHead != chain.head) revert PreviousHead();
        uint64 n = chain.seq;
        chain.head = keccak256(abi.encode(prevHead, receiptHash, n));
        chain.seq = n + 1;
        emit Receipt(
            n,
            receiptHash,
            prevHead,
            policyHash,
            uint8(kind),
            fill.tokenIn,
            fill.amountIn,
            fill.amountOut,
            fill.minOut,
            fill.refOut
        );
    }

    function _hold(Chain storage chain, bytes32 receiptHash, bytes32 prevHead, bytes32 policyHash, Kind kind) internal {
        if (kind != Kind.WAIT && kind != Kind.REJECT) revert InvalidKind();
        _commit(chain, receiptHash, prevHead, policyHash, kind, Fill(address(0), 0, 0, 0, 0));
    }
}
