// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ForkBase} from "./ForkBase.sol";
import {Addresses} from "../../script/Addresses.sol";
import {ProofTradeRouter} from "../../src/ProofTradeRouter.sol";
import {ReceiptChain} from "../../src/ReceiptChain.sol";
import {IV3SwapRouter} from "../../src/interfaces/IV3SwapRouter.sol";
import {IERC20} from "../../src/interfaces/IERC20.sol";

contract RouterForkTest is ForkBase {
    function testRealCallerSwap() public {
        _fork();
        ProofTradeRouter r = new ProofTradeRouter(address(this), Addresses.SWAPROUTER02_177);
        bytes32 policy = keccak256("policy");
        r.setPolicy(policy);
        _fund(address(this), 100e6);
        assertTrue(IERC20(Addresses.USDT_177).approve(address(r), 50e6));
        uint256 minOut = _ref(50e6) * 99 / 100;
        bytes32 hash = keccak256("router receipt");
        uint256 out = r.commitAndSwap(
            hash,
            0,
            IV3SwapRouter.ExactInputSingleParams(
                Addresses.USDT_177, Addresses.WHSK_177, 3000, address(this), 50e6, minOut, 0
            ),
            block.timestamp
        );
        assertGe(out, minOut);
        assertEq(IERC20(Addresses.WHSK_177).balanceOf(address(this)), out);
        assertEq(IERC20(Addresses.USDT_177).balanceOf(address(this)), 50e6);
        assertEq(IERC20(Addresses.USDT_177).allowance(address(r), Addresses.SWAPROUTER02_177), 0);
        assertEq(r.seq(address(this)), 1);
        assertEq(r.head(address(this)), keccak256(abi.encode(bytes32(0), hash, uint64(0))));
    }
}
