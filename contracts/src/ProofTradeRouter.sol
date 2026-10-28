// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ReceiptChain} from "./ReceiptChain.sol";
import {IV3SwapRouter} from "./interfaces/IV3SwapRouter.sol";
import {SafeToken} from "./lib/SafeToken.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @notice Permissionless swaps with independent receipt chains for each caller.
contract ProofTradeRouter is ReceiptChain, ReentrancyGuard {
    address public immutable owner;
    bytes32 public policyHash;
    mapping(address => Chain) private chains;
    error Unauthorized();
    error InvalidOwner();
    error Deadline();
    error Recipient();
    error Underfill();
    event PolicySet(bytes32 policyHash);

    /// @notice Set the immutable owner and SwapRouter02 destination.
    constructor(address owner_, address router_) {
        if (owner_ == address(0) || router_.code.length == 0) revert InvalidOwner();
        owner = owner_;
        router = router_;
    }
    address public immutable router;

    /// @notice Read a caller's next receipt sequence.
    function seq(address caller) external view returns (uint64) {
        return chains[caller].seq;
    }

    /// @notice Read a caller's latest chain head.
    function head(address caller) external view returns (bytes32) {
        return chains[caller].head;
    }

    /// @notice Owner selects the policy committed by subsequent receipts.
    function setPolicy(bytes32 hash) external {
        if (msg.sender != owner) revert Unauthorized();
        policyHash = hash;
        emit PolicySet(hash);
    }

    /// @notice Pull exact input and atomically swap to the caller and commit a receipt.
    function commitAndSwap(
        bytes32 receiptHash,
        bytes32 prevHead,
        IV3SwapRouter.ExactInputSingleParams calldata p,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Deadline();
        if (p.recipient != msg.sender) revert Recipient();
        if (prevHead != chains[msg.sender].head) revert PreviousHead();
        SafeToken.pull(p.tokenIn, msg.sender, p.amountIn);
        SafeToken.approve(p.tokenIn, router, p.amountIn);
        amountOut = IV3SwapRouter(router).exactInputSingle(p);
        SafeToken.approve(p.tokenIn, router, 0);
        if (amountOut < p.amountOutMinimum) revert Underfill();
        _commit(
            chains[msg.sender],
            receiptHash,
            prevHead,
            policyHash,
            Kind.TRADE,
            Fill(p.tokenIn, p.amountIn, amountOut, p.amountOutMinimum, 0)
        );
    }

    /// @notice Commit WAIT or REJECT without moving tokens.
    function commitHold(bytes32 hash, bytes32 prev, Kind kind) external nonReentrant {
        _hold(chains[msg.sender], hash, prev, policyHash, kind);
    }
}
