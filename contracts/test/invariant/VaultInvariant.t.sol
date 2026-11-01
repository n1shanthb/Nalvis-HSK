// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockRouter} from "../mocks/MockRouter.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {VaultHandler} from "./VaultHandler.sol";

contract VaultInvariantTest is StdInvariant, Test {
    EdgewiseVault public vault;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockRouter public router;
    MockPool public pool;
    MockAggregator public oracle;
    VaultHandler public handler;

    address public owner;
    address public agent;

    uint256 public initialDepositA = 1000e18;
    uint256 public initialDepositB = 1000e18;

    function setUp() public {
        vm.warp(10 days);
        owner = address(this);
        agent = makeAddr("invariant_agent");

        tokenA = new MockERC20(18);
        tokenB = new MockERC20(18);
        router = new MockRouter();
        pool = new MockPool(address(tokenA), address(tokenB));
        oracle = new MockAggregator();

        // Deploy vault with 1 hour twap
        vault = new EdgewiseVault(
            owner, address(router), address(pool), address(tokenA), address(tokenB), 3000, 300, address(0), 500, 1 hours
        );

        // Set initial mandate
        EdgewiseVault.Mandate memory m = EdgewiseVault.Mandate({
            agent: agent,
            expiry: block.timestamp + 30 days,
            maxTradeInA: 100e18,
            maxTradeInB: 100e18,
            maxDailyInB: 200e18,
            maxExposureBps: 10000,
            maxSlippageBps: 100,
            maxDrawdownBps: 2000, // 20%
            minIntervalSec: 60,
            policyHash: keccak256("invariant_policy")
        });
        vault.setMandate(m);

        // Seed balances
        tokenA.mint(address(vault), initialDepositA);
        tokenB.mint(address(vault), initialDepositB);
        tokenA.mint(address(router), 100_000e18);
        tokenB.mint(address(router), 100_000e18);

        // Deploy handler and target it
        handler = new VaultHandler(vault, tokenA, tokenB, router, pool, owner, agent);
        targetContract(address(handler));
    }

    /// @notice Invariant 1: Agent can never withdraw or hold vault tokens directly
    function invariant_agentCannotHoldVaultFunds() public view {
        assertEq(tokenA.balanceOf(agent), 0, "Agent held tokenA");
        assertEq(tokenB.balanceOf(agent), 0, "Agent held tokenB");
    }

    /// @notice Invariant 2: Stranger cannot withdraw or siphon swap proceeds
    function invariant_strangerCannotHoldVaultFunds() public view {
        assertEq(tokenA.balanceOf(handler.stranger()), 0, "Stranger held tokenA");
        assertEq(tokenB.balanceOf(handler.stranger()), 0, "Stranger held tokenB");
    }

    /// @notice Invariant 3: Router allowance is always zero after any action
    function invariant_routerAllowanceAlwaysZero() public view {
        assertEq(tokenA.allowance(address(vault), address(router)), 0, "tokenA allowance must be 0");
        assertEq(tokenB.allowance(address(vault), address(router)), 0, "tokenB allowance must be 0");
    }

    /// @notice Invariant 4: Minimum interval is enforced between successful trades
    function invariant_minIntervalEnforced() public view {
        assertFalse(handler.ghost_minIntervalViolated(), "Min interval violated between successful trades");
    }

    /// @notice Invariant 5: Inactive (expired, revoked, paused) mandates never authorize trades
    function invariant_inactiveMandateNeverTrades() public view {
        assertFalse(handler.ghost_tradeSucceededWhileInactive(), "Trade executed under inactive mandate");
    }

    /// @notice Invariant: A decision cannot execute after its validUntil timestamp.
    function invariant_expiredDecisionNeverTrades() public view {
        assertFalse(handler.ghost_tradeSucceededWithExpiredDecision(), "Expired decision executed");
    }

    /// @notice Invariant 6: Per-trade caps are never bypassed
    function invariant_perTradeCapNeverBypassed() public view {
        assertFalse(handler.ghost_tradeExceededPerTradeCap(), "Per trade cap exceeded");
    }

    /// @notice Invariant 7: Rolling 24-hour turnover cap is never exceeded
    function invariant_rollingTurnoverCapPreserved() public view {
        assertLe(vault.getRolling24hTurnover(), vault.getMandate().maxDailyInB, "Rolling turnover cap exceeded");
    }

    /// @notice Invariant 8: Slippage never exceeds 100 bps
    function invariant_slippageNeverExceedsCap() public view {
        assertLe(vault.getMandate().maxSlippageBps, 100, "Mandate slippage exceeded 100 bps");
        assertFalse(handler.ghost_tradeViolatedSlippage(), "Trade violated slippage limit");
    }

    /// @notice Invariant 9: Drawdown breaker blocks agent trades once triggered
    function invariant_drawdownBreakerEnforced() public view {
        assertFalse(handler.ghost_tradeSucceededInDrawdown(), "Trade executed during drawdown breach");
    }

    /// @notice Invariant 10: Nonce and receipt chain consistency (failed txs never advance state)
    function invariant_receiptChainAndNonceConsistency() public view {
        assertEq(vault.seq(), handler.ghost_successfulReceipts(), "Receipt seq out of sync");
        assertEq(vault.nextNonce(), handler.ghost_successfulTrades(), "Nonce out of sync");
        if (vault.seq() > 0) {
            assertTrue(vault.head() != bytes32(0), "Head cannot be zero when seq > 0");
        }
    }

    /// @notice Invariant 11: Vault owner remains unchanged when no transfer is requested.
    function invariant_ownerPreserved() public view {
        assertEq(vault.owner(), owner, "Vault owner mutated");
    }
}
