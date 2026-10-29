// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {TradeCalldata} from "../../script/TradeCalldata.s.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {Addresses} from "../../script/Addresses.sol";
import {EdgewiseVault} from "../../src/EdgewiseVault.sol";
import {ProofTradeRouter} from "../../src/ProofTradeRouter.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {TickMath} from "../../src/lib/TickMath.sol";
import {FullMath} from "../../src/lib/FullMath.sol";

contract DeployHarness is Deploy {
    function deployForTest(address owner, address agent, address deployer)
        external
        returns (EdgewiseVault, ProofTradeRouter)
    {
        return _deploy(owner, agent, deployer, 600);
    }
}

contract DeployTestnetForkTest is Test {
    EdgewiseVault deployed;
    address deployedAgent;
    /// @notice Exercise the actual CLI deployment entrypoint and real testnet swap.
    function testDeployAndRealTestnetTrade() public {
        string memory rpc = vm.envOr("HSK_TESTNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            console2.log("SKIP: HSK_TESTNET_RPC missing");
            vm.skip(true, "SKIP: HSK_TESTNET_RPC missing");
        }
        try vm.createSelectFork(rpc) returns (uint256) {}
        catch {
            console2.log("SKIP: testnet RPC unreachable");
            vm.skip(true, "SKIP: testnet RPC unreachable");
        }
        assertEq(block.chainid, 133);
        console2.log("Testnet fork block", block.number);
        address owner = makeAddr("testnet owner");
        address agent = makeAddr("testnet agent");
        address deployer = makeAddr("testnet deployer");
        vm.setEnv("OWNER_ADDRESS", vm.toString(owner));
        vm.setEnv("AGENT_ADDRESS", vm.toString(agent));
        vm.setEnv("DEPLOY_COMMIT", "eee9478fe78efdaa605a0517a8e119821fed1325");
        DeployHarness script = new DeployHarness();
        (EdgewiseVault v, ProofTradeRouter r) = script.deployForTest(owner, agent, deployer);
        deployed = v;
        deployedAgent = agent;
        assertEq(v.owner(), owner);
        assertEq(r.owner(), owner);
        assertEq(v.oracle(), address(0));
        assertEq(v.twapWindowSec(), 600);
        vm.prank(owner);
        v.setMandate(EdgewiseVault.Mandate(agent, block.timestamp + 7 days, 2e18, 100e18, 500e18, 8000, 100, 300, 0));
        deal(Addresses.USDT_133, address(v), 500e18);
        uint32[] memory times = new uint32[](2);
        times[0] = 600;
        (int56[] memory c,) = IUniswapV3Pool(Addresses.PRIMARYPOOL_133).observe(times);
        int56 delta = c[1] - c[0];
        int24 tick = int24(delta / 600);
        if (delta < 0 && delta % 600 != 0) --tick;
        uint160 sqrt = TickMath.getSqrtRatioAtTick(tick);
        uint256 refOut = FullMath.mulDiv(uint256(sqrt) * sqrt, 10e18, 1 << 192);
        uint256 minOut = refOut * 99 / 100;
        bytes32 hash = keccak256("T3 real testnet receipt");
        // amountOut comes from the real router; verify the full emitted payload.
        vm.recordLogs();
        vm.prank(agent);
        uint256 out = v.trade(
            EdgewiseVault.TradeParams(
                Addresses.USDT_133, 10e18, minOut, block.timestamp, block.timestamp + 60, v.nextNonce(), hash, 0, ReceiptChain.Kind.TRADE
            )
        );
        assertGe(out, minOut);
        assertEq(v.seq(), 1);
        assertEq(v.head(), keccak256(abi.encode(bytes32(0), hash, uint64(0))));
        assertEq(IERC20(Addresses.USDT_133).allowance(address(v), Addresses.SWAPROUTER02_133), 0);
        assertEq(IERC20(Addresses.WHSK_133).balanceOf(address(v)), out);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(v)) {
                assertEq(
                    logs[i].topics[0],
                    keccak256("Receipt(uint64,bytes32,bytes32,bytes32,uint8,address,uint256,uint256,uint256,uint256)")
                );
                assertEq(logs[i].topics[2], hash);
                assertEq(
                    logs[i].data,
                    abi.encode(
                        bytes32(0), bytes32(0), uint8(0), Addresses.USDT_133, uint256(10e18), out, minOut, refOut
                    )
                );
                found = true;
            }
        }
        assertTrue(found, "Receipt missing");

    }

    function testTradeHelperRealSell() public {
        testDeployAndRealTestnetTrade();
        _sellWithHelper(deployed, deployedAgent);
    }

    function _sellWithHelper(EdgewiseVault v, address agent) internal {
        vm.warp(block.timestamp + 300);
        vm.setEnv("VAULT_ADDRESS", vm.toString(address(v)));
        TradeCalldata helper = new TradeCalldata();
        bytes memory tradeData = helper.run();
        vm.prank(agent);
        (bool ok,) = address(v).call(tradeData);
        assertTrue(ok, "helper-built real WHSK sell failed");
        assertEq(v.seq(), 2);
        assertEq(IERC20(Addresses.WHSK_133).allowance(address(v), Addresses.SWAPROUTER02_133), 0);
    }

    function testReject177() public {
        vm.chainId(177);
        Deploy script = new Deploy();
        vm.expectRevert("Deploy: only chains 133/31337");
        script.run();
    }

    function testRejectDeployerEqualsAgent() public {
        vm.chainId(31337);
        address deployer = makeAddr("deployer");
        vm.setEnv("OWNER_ADDRESS", vm.toString(makeAddr("owner")));
        vm.setEnv("AGENT_ADDRESS", vm.toString(deployer));
        vm.setEnv("DEPLOY_COMMIT", "eee9478fe78efdaa605a0517a8e119821fed1325");
        DeployHarness script = new DeployHarness();
        vm.expectRevert("Deploy: roles must be distinct");
        script.deployForTest(makeAddr("owner"), deployer, deployer);
    }

    function testRejectOtherRoleCollisionsAndZero() public {
        vm.chainId(31337);
        DeployHarness script = new DeployHarness();
        address owner = makeAddr("owner");
        address agent = makeAddr("agent");
        vm.expectRevert("Deploy: roles must be distinct");
        script.deployForTest(owner, agent, owner);
        vm.expectRevert("Deploy: roles must be distinct");
        script.deployForTest(owner, owner, agent);
        vm.expectRevert("Deploy: zero role");
        script.deployForTest(address(0), agent, owner);
    }
}
