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
            owner,
            address(router),
            address(pool),
            address(tokenA),
            address(tokenB),
            3000,
            300,
            address(0),
            500,
            1 hours
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
            minIntervalSec: 60,
            maxDrawdownBps: 2000, // 20%
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

    /// @notice Invariant 1: Vault containment - Router allowance is always zero after any action
    function invariant_routerAllowanceAlwaysZero() public view {
        assertEq(tokenA.allowance(address(vault), address(router)), 0, "tokenA allowance to router must be 0");
        assertEq(tokenB.allowance(address(vault), address(router)), 0, "tokenB allowance to router must be 0");
    }

    /// @notice Invariant 2: Slippage cap can NEVER exceed 100 bps
    function invariant_maxSlippageBpsNeverExceedsCap() public view {
        EdgewiseVault.Mandate memory _m = vault.getMandate();
        assertLe(_m.maxSlippageBps, 100, "maxSlippageBps exceeded MAX_SLIPPAGE_CAP_BPS");
    }

    /// @notice Invariant 3: Max drawdown bps can NEVER exceed 10_000 bps (100%)
    function invariant_maxDrawdownBpsNeverExceeds100Percent() public view {
        EdgewiseVault.Mandate memory _m = vault.getMandate();
        assertLe(_m.maxDrawdownBps, 10000, "maxDrawdownBps cannot exceed 10000");
    }

    /// @notice Invariant 4: Vault owner is immutable / preserved
    function invariant_ownerPreserved() public view {
        assertEq(vault.owner(), owner, "Vault owner mutated");
    }

    /// @notice Invariant 5: Daily turnover cap is never exceeded on any calendar day
    function invariant_dailyTurnoverCapPreserved() public view {
        uint256 currentDay = block.timestamp / 1 days;
        EdgewiseVault.Mandate memory _m = vault.getMandate();
        assertLe(
            handler.ghost_dailyTurnoverInB(currentDay),
            _m.maxDailyInB,
            "Daily turnover cap violated"
        );
    }

    /// @notice Invariant 6: Sequential nonce and head consistency
    function invariant_receiptChainIntegrity() public view {
        assertGe(vault.seq(), 0, "Seq cannot be negative");
        if (vault.seq() > 0) {
            assertTrue(vault.head() != bytes32(0), "Head cannot be zero when seq > 0");
        }
    }
}
