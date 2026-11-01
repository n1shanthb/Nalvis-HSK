// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ReceiptChain} from "./ReceiptChain.sol";
import {IV3SwapRouter} from "./interfaces/IV3SwapRouter.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {SafeToken} from "./lib/SafeToken.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @notice Permissionless swaps with independent receipt chains for each caller.
contract ProofTradeRouter is ReceiptChain, ReentrancyGuard {
    address public owner;
    address public pendingOwner;
    bytes32 public policyHash;
    mapping(address => Chain) private chains;
    error Unauthorized();
    error InvalidOwner();
    error Deadline();
    error DecisionExpired(); // new error for decision expiry
    error Recipient();
    error Underfill();
    error PriceLimit();
    event PolicySet(bytes32 policyHash);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Set the initial owner and immutable SwapRouter02 destination.
    constructor(address owner_, address router_) {
        if (owner_ == address(0) || router_.code.length == 0) revert InvalidOwner();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
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

    /// @notice Nominate the next owner; pass address(0) to cancel a pending transfer.
    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert Unauthorized();
        if (newOwner == owner) revert InvalidOwner();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Accept ownership as the nominated address.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner || msg.sender == address(0)) revert Unauthorized();
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
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
        uint256 validUntil,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > validUntil) revert DecisionExpired();
        if (block.timestamp > deadline) revert Deadline();
        if (p.recipient != msg.sender) revert Recipient();
        // SwapRouter02 requires full consumption when its price limit is zero.
        if (p.sqrtPriceLimitX96 != 0) revert PriceLimit();
        if (prevHead != chains[msg.sender].head) revert PreviousHead();
        uint256 balBefore = IERC20(p.tokenIn).balanceOf(address(this));
        SafeToken.pull(p.tokenIn, msg.sender, p.amountIn);
        SafeToken.approve(p.tokenIn, router, p.amountIn);
        amountOut = IV3SwapRouter(router).exactInputSingle(p);
        SafeToken.approve(p.tokenIn, router, 0);
        uint256 balAfter = IERC20(p.tokenIn).balanceOf(address(this));
        if (amountOut < p.amountOutMinimum || balAfter != balBefore) revert Underfill();
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
