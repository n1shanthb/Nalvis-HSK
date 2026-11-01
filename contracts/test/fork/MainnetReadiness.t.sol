// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ForkBase} from "./ForkBase.sol";
import {DeployMainnet} from "../../script/DeployMainnet.s.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {ProofTradeRouter} from "../../src/ProofTradeRouter.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {Addresses} from "../../script/Addresses.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {FullMath} from "../../src/lib/FullMath.sol";
import {TickMath} from "../../src/lib/TickMath.sol";

contract MainnetReadinessTest is ForkBase {
    EdgewiseVault v;
    address owner;
    address agent;

    function testTinyPilotDeployTradeHoldPauseRevokeWithdraw() public {
        _fork();
        owner = makeAddr("mainnet rehearsal owner");
        agent = makeAddr("mainnet rehearsal agent");
        vm.setEnv("OWNER_ADDRESS", vm.toString(owner));
        vm.setEnv("AGENT_ADDRESS", vm.toString(agent));
        vm.setEnv("DEPLOY_COMMIT", "0000000000000000000000000000000000000000");
        vm.setEnv("MAINNET_EXECUTION_ACK", "I_ACCEPT_REAL_FUNDS_RISK_ON_177");
        ProofTradeRouter r;
        (v, r) = new DeployMainnet().run();
        assertEq(v.owner(), owner);
        assertEq(r.owner(), owner);
        assertEq(v.tokenA(), Addresses.WHSK_177);
        assertEq(v.tokenB(), Addresses.USDT_177);
        assertEq(v.oracle(), address(0));
        assertEq(v.twapWindowSec(), 600);
        _fund(address(v), 2e6);
        bytes32 policy = keccak256("fork-only reviewed policy");
        vm.prank(owner);
        v.setMandate(
            EdgewiseVault.Mandate(agent, block.timestamp + 1 days, 2e18, 1e5, 5e5, 8000, 100, 1000, 300, policy)
        );
        uint256 refOut;
        {
            uint32[] memory times = new uint32[](2);
            times[0] = 600;
            (int56[] memory c,) = IUniswapV3Pool(Addresses.PRIMARYPOOL_177).observe(times);
            int56 delta = c[1] - c[0];
            int24 tick = int24(delta / 600);
            if (delta < 0 && delta % 600 != 0) --tick;
            uint160 sqrt = TickMath.getSqrtRatioAtTick(tick);
            refOut = FullMath.mulDiv(1 << 192, 1e5, uint256(sqrt) * sqrt);
        }
        bytes32 receipt = keccak256("tiny pilot receipt");
        EdgewiseVault.TradeParams memory p = EdgewiseVault.TradeParams(
            Addresses.USDT_177,
            1e5,
            refOut * 99 / 100,
            block.timestamp,
            block.timestamp + 60,
            0,
            receipt,
            0,
            ReceiptChain.Kind.TRADE
        );
        vm.prank(agent);
        uint256 out = v.trade(p);
        assertGe(out, p.minOut);
        assertEq(IERC20(Addresses.USDT_177).balanceOf(address(v)), 19e5);
        assertEq(IERC20(Addresses.USDT_177).allowance(address(v), Addresses.SWAPROUTER02_177), 0);
        assertEq(v.seq(), 1);
        assertEq(v.head(), keccak256(abi.encode(bytes32(0), receipt, uint64(0))));
        bytes32 hold = keccak256("pilot hold");
        bytes32 previous = v.head();
        vm.prank(agent);
        v.commitHold(hold, previous, ReceiptChain.Kind.WAIT);
        assertEq(v.seq(), 2);
        vm.prank(owner);
        v.pause();
        vm.prank(agent);
        vm.expectRevert();
        v.trade(p);
        vm.prank(owner);
        v.unpause();
        vm.prank(owner);
        v.revoke();
        vm.prank(agent);
        vm.expectRevert();
        v.trade(p);
        vm.prank(owner);
        v.withdraw(Addresses.USDT_177, 19e5, owner);
        vm.prank(owner);
        v.withdraw(Addresses.WHSK_177, out, owner);
        assertEq(IERC20(Addresses.USDT_177).balanceOf(address(v)), 0);
        assertEq(IERC20(Addresses.WHSK_177).balanceOf(address(v)), 0);
    }
}
