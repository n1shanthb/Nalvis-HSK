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
    address public immutable stranger;

    // Ghost tracking variables for invariant checking
    uint256 public ghost_successfulTrades;
    uint256 public ghost_failedTrades;
    uint256 public ghost_successfulReceipts;
    uint256 public ghost_lastSuccessfulTradeTimestamp;
    bool public ghost_minIntervalViolated;
    bool public ghost_tradeSucceededWhileInactive;
    bool public ghost_tradeSucceededInDrawdown;
    bool public ghost_tradeExceededPerTradeCap;
    bool public ghost_tradeViolatedSlippage;
    bool public ghost_tradeSucceededWithExpiredDecision;

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
        stranger = makeAddr("invariant_stranger");
    }

    /// @notice Handler action: Attempt to trade from the agent with randomized parameters
    function trade(
        bool tokenAIn,
        uint256 amountInRaw,
        uint256 timeJump,
        uint256 validUntilDelta,
        uint256 deadlineDelta,
        uint256 minOutDelta
    ) public {
        timeJump = bound(timeJump, 0, 2 days);
        if (timeJump > 0) {
            vm.warp(block.timestamp + timeJump);
        }

        address tokenIn = tokenAIn ? address(tokenA) : address(tokenB);
        uint256 amountIn = bound(amountInRaw, 1e18, 150e18);

        uint256 minOut;
        {
            uint256 slip = uint256(vault.getMandate().maxSlippageBps);
            if (minOutDelta % 10 == 0) {
                minOut = (amountIn * 95) / 100;
            } else {
                minOut = (amountIn * (10_000 - slip)) / 10_000;
            }
        }

        uint256 validUntil = (validUntilDelta % 8 == 0)
            ? (block.timestamp > 1 ? block.timestamp - 1 : 0)
            : block.timestamp + bound(validUntilDelta, 1, 3600);

        uint256 deadline = (deadlineDelta % 9 == 0)
            ? (block.timestamp > 1 ? block.timestamp - 1 : 0)
            : block.timestamp + bound(deadlineDelta, 60, 3600);

        bytes32 rHash = keccak256(abi.encodePacked("invariant_trade", ghost_successfulReceipts + ghost_failedTrades));

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

        // Pre-state capture
        uint256 preSeq = vault.seq();
        uint256 preNonce = vault.nextNonce();
        bytes32 preHead = vault.head();

        bool inDrawdown = false;
        {
            uint256 hwm = vault.highWaterMark();
            EdgewiseVault.Mandate memory _m = vault.getMandate();
            if (_m.maxDrawdownBps > 0 && hwm > 0) {
                uint256 curTotal = tokenA.balanceOf(address(vault)) + tokenB.balanceOf(address(vault));
                if (curTotal < (hwm * (10_000 - _m.maxDrawdownBps)) / 10_000) {
                    inDrawdown = true;
                }
            }
        }

        vm.prank(agent);
        try vault.trade(p) returns (uint256 out) {
            ghost_successfulTrades++;
            ghost_successfulReceipts++;

            EdgewiseVault.Mandate memory m = vault.getMandate();
            if (vault.paused() || block.timestamp >= m.expiry || m.agent == address(0)) {
                ghost_tradeSucceededWhileInactive = true;
            }
            if (ghost_successfulTrades > 1 && block.timestamp < ghost_lastSuccessfulTradeTimestamp + m.minIntervalSec) {
                ghost_minIntervalViolated = true;
            }
            if (inDrawdown) {
                ghost_tradeSucceededInDrawdown = true;
            }
            if (amountIn > (tokenIn == address(tokenA) ? m.maxTradeInA : m.maxTradeInB)) {
                ghost_tradeExceededPerTradeCap = true;
            }
            if (minOut < (amountIn * (10_000 - m.maxSlippageBps)) / 10_000) {
                ghost_tradeViolatedSlippage = true;
            }
            if (block.timestamp > validUntil) {
                ghost_tradeSucceededWithExpiredDecision = true;
            }

            ghost_lastSuccessfulTradeTimestamp = block.timestamp;

            // Invariant checks on success:
            assertEq(MockERC20(tokenIn).allowance(address(vault), address(router)), 0, "Allowance not zero on success");
            assertEq(vault.seq(), preSeq + 1, "Seq did not increment");
            assertEq(vault.nextNonce(), preNonce + 1, "Nonce did not increment");
            assertTrue(vault.head() != preHead, "Head did not update");
            assertGe(out, minOut, "Output below minOut");
        } catch {
            ghost_failedTrades++;
            // Invariant checks on failure: failed txs MUST NOT advance nonce or receipt state
            assertEq(vault.seq(), preSeq, "Failed trade advanced seq");
            assertEq(vault.nextNonce(), preNonce, "Failed trade advanced nonce");
            assertEq(vault.head(), preHead, "Failed trade advanced head");
            assertEq(tokenA.allowance(address(vault), address(router)), 0, "Dangling tokenA allowance on failure");
            assertEq(tokenB.allowance(address(vault), address(router)), 0, "Dangling tokenB allowance on failure");
        }
    }

    /// @notice Handler action: Attempt to commit hold receipt
    function commitHold(uint8 kindRaw) public {
        ReceiptChain.Kind kind = (kindRaw % 2 == 0) ? ReceiptChain.Kind.WAIT : ReceiptChain.Kind.REJECT;
        bytes32 rHash = keccak256(abi.encodePacked("invariant_hold", ghost_successfulReceipts));
        uint256 preSeq = vault.seq();
        uint256 preNonce = vault.nextNonce();
        bytes32 preHead = vault.head();

        vm.prank(agent);
        try vault.commitHold(rHash, vault.head(), kind) {
            ghost_successfulReceipts++;
            assertEq(vault.seq(), preSeq + 1, "Hold receipt did not increment seq");
            assertEq(vault.nextNonce(), preNonce, "Hold receipt changed nonce");
            assertTrue(vault.head() != preHead, "Hold receipt did not update head");
        } catch {
            assertEq(vault.seq(), preSeq, "Failed hold changed seq");
            assertEq(vault.head(), preHead, "Failed hold changed head");
        }
    }

    /// @notice Handler action: Agent tries to withdraw (must always revert)
    function agentAttemptWithdraw(bool withdrawA, uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 500e18);
        address token = withdrawA ? address(tokenA) : address(tokenB);

        vm.prank(agent);
        try vault.withdraw(token, amount, agent) {
            assertTrue(false, "Agent must never be able to withdraw");
        } catch {}

        assertEq(tokenA.balanceOf(agent), 0, "Agent held tokenA");
        assertEq(tokenB.balanceOf(agent), 0, "Agent held tokenB");
    }

    /// @notice Handler action: Stranger tries to withdraw or trade (must always revert)
    function strangerActions(bool withdrawA, uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 100e18);
        address token = withdrawA ? address(tokenA) : address(tokenB);

        vm.prank(stranger);
        try vault.withdraw(token, amount, stranger) {
            assertTrue(false, "Stranger cannot withdraw");
        } catch {}

        EdgewiseVault.TradeParams memory p = EdgewiseVault.TradeParams(
            token,
            amount,
            (amount * 99) / 100,
            block.timestamp + 300,
            block.timestamp + 300,
            vault.nextNonce(),
            keccak256("stranger_trade"),
            vault.head(),
            ReceiptChain.Kind.TRADE
        );

        vm.prank(stranger);
        try vault.trade(p) {
            assertTrue(false, "Stranger cannot trade");
        } catch {}

        assertEq(tokenA.balanceOf(stranger), 0, "Stranger held tokenA");
        assertEq(tokenB.balanceOf(stranger), 0, "Stranger held tokenB");
    }

    /// @notice Handler action: Deposit funds into vault
    function deposit(bool depositA, uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1e18, 500e18);
        MockERC20 tok = depositA ? tokenA : tokenB;
        tok.mint(address(this), amount);
        tok.approve(address(vault), amount);
        vault.deposit(address(tok), amount);
    }

    /// @notice Handler action: Owner withdraw
    function ownerWithdraw(bool withdrawA, uint256 amountRaw) public {
        MockERC20 tok = withdrawA ? tokenA : tokenB;
        uint256 bal = tok.balanceOf(address(vault));
        if (bal == 0) return;
        uint256 amount = bound(amountRaw, 1, bal);

        vm.prank(owner);
        try vault.withdraw(address(tok), amount, owner) {} catch {}
    }

    /// @notice Handler action: Pause or unpause
    function setPaused(bool shouldPause) public {
        vm.prank(owner);
        if (shouldPause && !vault.paused()) {
            vault.pause();
        } else if (!shouldPause && vault.paused()) {
            vault.unpause();
        }
    }

    /// @notice Handler action: Owner revokes agent authority.
    function revoke() public {
        vm.prank(owner);
        vault.revoke();
    }

    /// @notice Handler action: Time advance
    function warp(uint256 deltaRaw) public {
        uint256 delta = bound(deltaRaw, 1, 3 days);
        vm.warp(block.timestamp + delta);
    }

    /// @notice Handler action: Owner updates mandate with randomized valid/invalid values
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
                assertTrue(false, "setMandate must revert on invalid caps");
            } catch {}
        } else {
            try vault.setMandate(newM) {} catch {}
        }
    }
}
