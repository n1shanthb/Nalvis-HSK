// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockPool} from "../mocks/MockPool.sol";

contract VaultHandler is Test {
    EdgewiseVault public immutable vault;
    MockERC20 public immutable tokenA;
    MockERC20 public immutable tokenB;
    MockRouter public immutable router;
    MockPool public immutable pool;

    address public immutable owner;
    address public immutable agent;

    // Ghost tracking variables for invariant checking
    uint256 public ghost_successfulTrades;
    uint256 public ghost_failedTrades;
    uint256 public ghost_lastTradeTimestamp;
    mapping(uint256 => uint256) public ghost_dailyTurnoverInB;
    uint256 public ghost_ownerWithdrawalsA;
    uint256 public ghost_ownerWithdrawalsB;
    uint256 public ghost_depositsA;
    uint256 public ghost_depositsB;

    constructor(
        EdgewiseVault _vault,
        MockERC20 _tokenA,
        MockERC20 _tokenB,
        MockRouter _router,
        MockPool _pool,
        address _owner,
        address _agent
    ) {
        vault = _vault;
        tokenA = _tokenA;
        tokenB = _tokenB;
        router = _router;
        pool = _pool;
        owner = _owner;
        agent = _agent;
    }

    /// @notice Handler action: Attempt to trade from the agent with bounded randomized inputs
    function trade(
        bool tokenAIn,
        uint256 amountInRaw,
        uint256 timeJump,
        uint256 validUntilDelta
    ) public {
        timeJump = bound(timeJump, 0, 3 days);
        if (timeJump > 0) {
            vm.warp(block.timestamp + timeJump);
        }

        address tokenIn = tokenAIn ? address(tokenA) : address(tokenB);
        uint256 amountIn = bound(amountInRaw, 1e18, 200e18);

        // Read mandate once into memory via struct-returning getter
        EdgewiseVault.Mandate memory _m = vault.getMandate();
        uint256 slipBps = uint256(_m.maxSlippageBps);
        uint256 minOut = (amountIn * (10_000 - slipBps)) / 10_000;

        uint256 validUntil;
        if (validUntilDelta % 10 == 0) {
            // Intentionally expired validUntil (in the past)
            validUntil = block.timestamp > 1 ? block.timestamp - 1 : 0;
        } else {
            validUntil = block.timestamp + bound(validUntilDelta, 1, 3600);
        }

        uint256 deadline = block.timestamp + 300;
        bytes32 rHash = keccak256(abi.encodePacked("invariant_trade", ghost_successfulTrades + ghost_failedTrades));

        EdgewiseVault.TradeParams memory p = EdgewiseVault.TradeParams(
            tokenIn,
            amountIn,
            minOut,
            deadline,
            validUntil,
            vault.nextNonce(),
            rHash,
            vault.head(),
            ReceiptChain.Kind.TRADE
        );

        // Record pre-state
        uint256 preSeq = vault.seq();

        vm.prank(agent);
        try vault.trade(p) returns (uint256 out) {
            ghost_successfulTrades++;
            ghost_lastTradeTimestamp = block.timestamp;
            ghost_dailyTurnoverInB[block.timestamp / 1 days] += amountIn; // 1:1 price mock

            // Invariant sub-check: router allowance must immediately be 0
            assertEq(MockERC20(tokenIn).allowance(address(vault), address(router)), 0, "Router allowance not zero");
            assertEq(vault.seq(), preSeq + 1, "Seq did not increment");
            assertGe(out, minOut, "Output below minOut");
        } catch {
            ghost_failedTrades++;
            // Assert that on revert, allowance is never left dangling
            assertEq(MockERC20(tokenIn).allowance(address(vault), address(router)), 0, "Dangling allowance on trade revert");
        }
    }

    /// @notice Handler action: Attempt to commit a hold receipt (WAIT or REJECT)
    function commitHold(uint8 kindRaw) public {
        ReceiptChain.Kind kind = (kindRaw % 2 == 0) ? ReceiptChain.Kind.WAIT : ReceiptChain.Kind.REJECT;
        bytes32 rHash = keccak256(abi.encodePacked("invariant_hold", ghost_successfulTrades + ghost_failedTrades));

        uint256 preSeq = vault.seq();
        vm.prank(agent);
        try vault.commitHold(rHash, vault.head(), kind) {
            assertEq(vault.seq(), preSeq + 1, "Hold receipt seq not incremented");
        } catch {
            // Expected if paused or revoked or expired
        }
    }

    /// @notice Handler action: Agent tries to withdraw funds (must always fail)
    function agentAttemptWithdraw(bool withdrawA, uint256 amount) public {
        amount = bound(amount, 1, 1000e18);
        address token = withdrawA ? address(tokenA) : address(tokenB);

        vm.prank(agent);
        try vault.withdraw(token, amount, agent) {
            assertTrue(false, "Agent should never be able to withdraw");
        } catch {
            // Expected: Unauthorized()
        }
    }

    /// @notice Handler action: Stranger tries to trade or withdraw (must always fail)
    function strangerActions(address _stranger, bool withdrawA, uint256 amount) public {
        vm.assume(_stranger != owner && _stranger != agent && _stranger != address(0));
        amount = bound(amount, 1, 100e18);
        address token = withdrawA ? address(tokenA) : address(tokenB);

        // Stranger withdraw attempt
        vm.prank(_stranger);
        try vault.withdraw(token, amount, _stranger) {
            assertTrue(false, "Stranger should never be able to withdraw");
        } catch {}

        // Stranger trade attempt
        EdgewiseVault.TradeParams memory p = EdgewiseVault.TradeParams(
            token,
            amount,
            amount * 99 / 100,
            block.timestamp + 300,
            block.timestamp + 300,
            vault.nextNonce(),
            keccak256("stranger"),
            vault.head(),
            ReceiptChain.Kind.TRADE
        );
        vm.prank(_stranger);
        try vault.trade(p) {
            assertTrue(false, "Stranger should never be able to trade");
        } catch {}
    }

    /// @notice Handler action: Deposit funds into vault
    function deposit(bool depositA, uint256 amount) public {
        amount = bound(amount, 1e18, 500e18);
        if (depositA) {
            tokenA.mint(address(vault), amount);
            ghost_depositsA += amount;
        } else {
            tokenB.mint(address(vault), amount);
            ghost_depositsB += amount;
        }
    }

    /// @notice Handler action: Owner withdraw
    function ownerWithdraw(bool withdrawA, uint256 amount) public {
        MockERC20 tok = withdrawA ? tokenA : tokenB;
        uint256 bal = tok.balanceOf(address(vault));
        if (bal == 0) return;
        amount = bound(amount, 1, bal);

        vm.prank(owner);
        try vault.withdraw(address(tok), amount, owner) {
            if (withdrawA) {
                ghost_ownerWithdrawalsA += amount;
            } else {
                ghost_ownerWithdrawalsB += amount;
            }
        } catch {
            // e.g. if paused or error
        }
    }

    /// @notice Handler action: Owner pause / unpause
    function setPaused(bool shouldPause) public {
        vm.prank(owner);
        if (shouldPause && !vault.paused()) {
            vault.pause();
        } else if (!shouldPause && vault.paused()) {
            vault.unpause();
        }
    }

    /// @notice Handler action: Advance time
    function warp(uint256 delta) public {
        delta = bound(delta, 1, 7 days);
        vm.warp(block.timestamp + delta);
    }

    /// @notice Handler action: Attempt to set mandate (tests maxSlippageBps and maxDrawdownBps caps)
    function attemptSetMandate(uint16 maxSlippageBps, uint16 maxDrawdownBps) public {
        EdgewiseVault.Mandate memory currentM = vault.getMandate();
        EdgewiseVault.Mandate memory newM = EdgewiseVault.Mandate(
            agent,
            block.timestamp + 30 days,
            currentM.maxTradeInA,
            currentM.maxTradeInB,
            currentM.maxDailyInB,
            currentM.maxExposureBps,
            maxSlippageBps,
            maxDrawdownBps,
            currentM.minIntervalSec,
            keccak256("newPolicy")
        );

        vm.prank(owner);
        if (maxSlippageBps > 100 || maxDrawdownBps > 10_000) {
            try vault.setMandate(newM) {
                assertTrue(false, "setMandate should revert if maxSlippageBps > 100 or maxDrawdownBps > 10000");
            } catch {}
        } else {
            try vault.setMandate(newM) {} catch {}
        }
    }
}
