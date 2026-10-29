// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ReceiptChain} from "./ReceiptChain.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IV3SwapRouter} from "./interfaces/IV3SwapRouter.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {SafeToken} from "./lib/SafeToken.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {TickMath} from "./lib/TickMath.sol";
import {FullMath} from "./lib/FullMath.sol";

/// @notice Owner-governed, pair-scoped trading with atomic receipt commitments.
contract EdgewiseVault is ReceiptChain, ReentrancyGuard {
    address public immutable owner;
    address public immutable router;
    address public immutable pool;
    address public immutable tokenA;
    address public immutable tokenB;
    uint24 public immutable fee;
    uint32 public immutable twapWindowSec;
    address public immutable oracle;
    uint16 public immutable oracleBandBps;
    uint256 public immutable oracleMaxAge;
    uint256 private immutable unitA;
    uint256 private immutable unitB;
    uint16 public constant MAX_SLIPPAGE_CAP_BPS = 100;

    struct Mandate {
        address agent;
        uint256 expiry;
        uint256 maxTradeInA;
        uint256 maxTradeInB;
        uint256 maxDailyInB;
        uint16 maxExposureBps;
        uint16 maxSlippageBps;
        uint16 maxDrawdownBps; // max drawdown in bps from high-water mark (0 = disabled)
        uint256 minIntervalSec;
        bytes32 policyHash;
    }

    struct TradeParams {
        address tokenIn;
        uint256 amountIn;
        uint256 minOut;
        uint256 deadline;
        uint256 validUntil; // new field for decision expiry
        uint256 nonce;
        bytes32 receiptHash;
        bytes32 prevHead;
        Kind kind;
    }
    Chain private chain;
    Mandate public mandate;
    bool public paused;
    uint256 public nextNonce;
    uint256 public lastTradeAt;
    struct TurnoverSlot {
        uint32 epochBucket;
        uint224 notionalB;
    }
    TurnoverSlot[48] private _turnoverSlots;
    uint256 public highWaterMark;
    error Unauthorized();
    error InvalidConfig();
    error InvalidMandate();
    error Inactive();
    error Deadline();
    error DecisionExpired(); // new error for decision expiry
    error Nonce();
    error Interval();
    error TradeCap();
    error DailyCap();
    error Exposure();
    error Slippage();
    error Underfill();
    error InvalidToken();
    error OracleInvalid();
    error Drawdown(); // drawdown circuit breaker error
    event MandateSet(Mandate mandate);
    event Revoked();
    event Paused(bool paused);
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    modifier onlyAgent() {
        if (msg.sender != mandate.agent || msg.sender == address(0)) revert Unauthorized();
        if (paused || block.timestamp >= mandate.expiry) revert Inactive();
        _;
    }

    /// @notice All structural configuration is immutable, with an optional oracle.
    constructor(
        address owner_,
        address router_,
        address pool_,
        address tokenA_,
        address tokenB_,
        uint24 fee_,
        uint32 window_,
        address oracle_,
        uint16 band_,
        uint256 age_
    ) {
        if (
            owner_ == address(0) || router_.code.length == 0 || pool_.code.length == 0 || tokenA_ == tokenB_
                || window_ == 0 || band_ > 10000
        ) revert InvalidConfig();
        IUniswapV3Pool p = IUniswapV3Pool(pool_);
        if (
            p.fee() != fee_
                || !((p.token0() == tokenA_ && p.token1() == tokenB_)
                    || (p.token0() == tokenB_ && p.token1() == tokenA_))
        ) revert InvalidConfig();
        uint8 da = IERC20(tokenA_).decimals();
        uint8 db = IERC20(tokenB_).decimals();
        if (da > 38 || db > 38) revert InvalidConfig();
        unitA = 10 ** da;
        unitB = 10 ** db;
        owner = owner_;
        router = router_;
        pool = pool_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        fee = fee_;
        twapWindowSec = window_;
        oracle = oracle_;
        oracleBandBps = band_;
        oracleMaxAge = age_;
    }

    /// @notice Next receipt sequence number.
    function seq() external view returns (uint64) {
        return chain.seq;
    }

    /// @notice Most recent receipt chain head.
    function head() external view returns (bytes32) {
        return chain.head;
    }

    /// @notice Replace the mandate, preserving nonce, interval and daily spend history, resetting highWaterMark.
    function setMandate(Mandate calldata m) external onlyOwner {
        if (
            m.agent == owner || m.agent == address(0) || m.expiry <= block.timestamp
                || m.maxSlippageBps > MAX_SLIPPAGE_CAP_BPS || m.maxExposureBps > 10000
                || m.maxDrawdownBps > 10000
        ) revert InvalidMandate();
        mandate = m;
        (bool ok, int24 tick) = _tryTick();
        if (ok) {
            uint256 valA = _quote(tick, IERC20(tokenA).balanceOf(address(this)), tokenA);
            uint256 valB = IERC20(tokenB).balanceOf(address(this));
            highWaterMark = valA + valB;
        } else {
            highWaterMark = 0;
        }
        emit MandateSet(m);
    }

    /// @notice Immediately remove agent authority.
    function revoke() external onlyOwner {
        mandate.agent = address(0);
        emit Revoked();
    }

    /// @notice Withdraw tokens to an owner-selected recipient. Never blocked by TWAP failures.
    function withdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        uint256 bA_before = IERC20(tokenA).balanceOf(address(this));
        uint256 bB_before = IERC20(tokenB).balanceOf(address(this));

        SafeToken.transfer(token, to, amount);

        (bool ok, int24 tick) = _tryTick();
        if (ok) {
            uint256 valA_before = _quote(tick, bA_before, tokenA);
            uint256 totalBefore = valA_before + bB_before;
            uint256 bA_after = IERC20(tokenA).balanceOf(address(this));
            uint256 bB_after = IERC20(tokenB).balanceOf(address(this));
            uint256 valA_after = _quote(tick, bA_after, tokenA);
            uint256 totalAfter = valA_after + bB_after;

            if (totalBefore > 0 && highWaterMark > 0) {
                if (totalBefore >= highWaterMark) {
                    highWaterMark = totalAfter;
                } else {
                    highWaterMark = FullMath.mulDiv(highWaterMark, totalAfter, totalBefore);
                }
            } else {
                highWaterMark = totalAfter;
            }
        } else {
            if (token == tokenB) {
                if (highWaterMark > amount) {
                    highWaterMark -= amount;
                } else {
                    highWaterMark = 0;
                }
            }
        }
    }

    /// @notice Stop agent actions.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    /// @notice Resume agent actions.
    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /// @notice Returns the full mandate struct (public getter returns tuple, not struct).
    function getMandate() external view returns (Mandate memory) {
        return mandate;
    }

    /// @notice Returns the rolling 24-hour notional turnover in tokenB terms across 48 30-min buckets.
    function getRolling24hTurnover() public view returns (uint256 total) {
        uint32 currentBucket = uint32(block.timestamp / 30 minutes);
        for (uint256 i = 0; i < 48; ++i) {
            TurnoverSlot memory s = _turnoverSlots[i];
            if (currentBucket >= s.epochBucket && currentBucket - s.epochBucket < 48) {
                total += s.notionalB;
            }
        }
    }

    /// @notice Backwards-compatible alias for getRolling24hTurnover.
    function dailyNotionalB() external view returns (uint256) {
        return getRolling24hTurnover();
    }

    /// @notice UTC calendar day bucket for backwards compatibility.
    function dailyBucket() external view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Pull an exact pre-approved deposit of either configured token.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (token != tokenA && token != tokenB) revert InvalidToken();
        SafeToken.pull(token, msg.sender, amount);
        (bool ok, int24 tick) = _tryTick();
        if (ok) {
            uint256 depVal = token == tokenB ? amount : _quote(tick, amount, tokenA);
            if (highWaterMark == 0) {
                uint256 valA = _quote(tick, IERC20(tokenA).balanceOf(address(this)), tokenA);
                uint256 valB = IERC20(tokenB).balanceOf(address(this));
                highWaterMark = valA + valB;
            } else {
                highWaterMark += depVal;
            }
        } else {
            if (token == tokenB) {
                highWaterMark += amount;
            }
        }
    }

    function _tryTick() private view returns (bool ok, int24 tick) {
        uint32[] memory times = new uint32[](2);
        times[0] = twapWindowSec;
        try IUniswapV3Pool(pool).observe(times) returns (int56[] memory c, uint160[] memory) {
            if (c.length >= 2) {
                int56 delta;
                unchecked {
                    delta = c[1] - c[0];
                }
                int56 w = int56(uint56(twapWindowSec));
                int56 mean = delta / w;
                if (delta < 0 && delta % w != 0) --mean;
                if (mean >= -887272 && mean <= 887272) {
                    return (true, int24(mean));
                }
            }
        } catch {}
        return (false, 0);
    }

    function _tick() private view returns (int24 tick) {
        uint32[] memory times = new uint32[](2);
        times[0] = twapWindowSec;
        (int56[] memory c,) = IUniswapV3Pool(pool).observe(times);
        int56 delta;
        unchecked {
            delta = c[1] - c[0];
        }
        int56 w = int56(uint56(twapWindowSec));
        int56 mean = delta / w;
        if (delta < 0 && delta % w != 0) --mean;
        if (mean < -887272 || mean > 887272) revert InvalidConfig();
        tick = int24(mean);
    }

    function _quote(int24 tick, uint256 amount, address input) private view returns (uint256) {
        uint160 sqrt = TickMath.getSqrtRatioAtTick(tick);
        bool forward = input < (input == tokenA ? tokenB : tokenA);
        if (sqrt <= type(uint128).max) {
            uint256 ratio = uint256(sqrt) * sqrt;
            return forward ? FullMath.mulDiv(ratio, amount, 1 << 192) : FullMath.mulDiv(1 << 192, amount, ratio);
        }
        uint256 ratio128 = FullMath.mulDiv(sqrt, sqrt, 1 << 64);
        return forward ? FullMath.mulDiv(ratio128, amount, 1 << 128) : FullMath.mulDiv(1 << 128, amount, ratio128);
    }

    function _oracle(int24 tick) private view {
        if (oracle == address(0)) return;
        (uint80 round, int256 answer,, uint256 updated, uint80 answered) = IAggregatorV3(oracle).latestRoundData();
        if (
            answer <= 0 || updated == 0 || updated > block.timestamp || block.timestamp - updated > oracleMaxAge
                || answered < round
        ) revert OracleInvalid();
        uint8 decimals = IAggregatorV3(oracle).decimals();
        if (decimals > 38) revert OracleInvalid();
        uint256 oracleB = FullMath.mulDiv(uint256(answer), unitB, 10 ** decimals);
        uint256 twapB = _quote(tick, unitA, tokenA);
        uint256 diff = twapB > oracleB ? twapB - oracleB : oracleB - twapB;
        if (oracleB == 0 || diff > FullMath.mulDiv(oracleB, oracleBandBps, 10000)) revert OracleInvalid();
    }

    /// @notice Execute a mandate-bounded swap and append its receipt atomically.
    function trade(TradeParams calldata p) external onlyAgent nonReentrant returns (uint256 amountOut) {
        if (p.kind != Kind.TRADE && p.kind != Kind.RESIZE) revert InvalidKind();
        if (p.prevHead != chain.head) revert PreviousHead();
        if (block.timestamp > p.validUntil) revert DecisionExpired();
        if (block.timestamp > p.deadline) revert Deadline();
        if (p.nonce != nextNonce) revert Nonce();
        if (block.timestamp < lastTradeAt + mandate.minIntervalSec) revert Interval();
        if (p.tokenIn != tokenA && p.tokenIn != tokenB) revert InvalidToken();
        if (p.amountIn == 0 || p.amountIn > (p.tokenIn == tokenA ? mandate.maxTradeInA : mandate.maxTradeInB)) {
            revert TradeCap();
        }
        int24 tick = _tick();
        _oracle(tick);
        uint256 refOut = _quote(tick, p.amountIn, p.tokenIn);
        if (refOut == 0 || p.minOut < FullMath.mulDiv(refOut, 10000 - mandate.maxSlippageBps, 10000)) {
            revert Slippage();
        }
        uint256 preValA = _quote(tick, IERC20(tokenA).balanceOf(address(this)), tokenA);
        uint256 preTotalVal = preValA + IERC20(tokenB).balanceOf(address(this));
        if (highWaterMark == 0 || preTotalVal > highWaterMark) {
            highWaterMark = preTotalVal;
        } else if (
            mandate.maxDrawdownBps > 0
                && preTotalVal < FullMath.mulDiv(highWaterMark, 10000 - mandate.maxDrawdownBps, 10000)
        ) {
            revert Drawdown();
        }
        uint256 tradeNotionalB = p.tokenIn == tokenB ? p.amountIn : refOut;
        if (getRolling24hTurnover() + tradeNotionalB > mandate.maxDailyInB) revert DailyCap();
        ++nextNonce;
        lastTradeAt = block.timestamp;
        amountOut = _swap(p, tick);
        _recordTurnover(tradeNotionalB);
        _commit(
            chain,
            p.receiptHash,
            p.prevHead,
            mandate.policyHash,
            p.kind,
            Fill(p.tokenIn, p.amountIn, amountOut, p.minOut, refOut)
        );
    }

    function _recordTurnover(uint256 notionalB) private {
        uint32 currentBucket = uint32(block.timestamp / 30 minutes);
        uint256 slotIdx = currentBucket % 48;
        TurnoverSlot storage s = _turnoverSlots[slotIdx];
        if (s.epochBucket == currentBucket) {
            s.notionalB += uint224(notionalB);
        } else {
            s.epochBucket = currentBucket;
            s.notionalB = uint224(notionalB);
        }
    }

    function _swap(TradeParams calldata p, int24 tick) private returns (uint256 amountOut) {
        address output = p.tokenIn == tokenA ? tokenB : tokenA;
        uint256 beforeOut = IERC20(output).balanceOf(address(this));
        uint256 beforeIn = IERC20(p.tokenIn).balanceOf(address(this));
        uint256 preA = _quote(tick, IERC20(tokenA).balanceOf(address(this)), tokenA);
        uint256 preTotal = preA + IERC20(tokenB).balanceOf(address(this));
        SafeToken.approve(p.tokenIn, router, p.amountIn);
        amountOut = IV3SwapRouter(router)
            .exactInputSingle(
                IV3SwapRouter.ExactInputSingleParams(p.tokenIn, output, fee, address(this), p.amountIn, p.minOut, 0)
            );
        SafeToken.approve(p.tokenIn, router, 0);
        if (
            amountOut < p.minOut || IERC20(output).balanceOf(address(this)) != beforeOut + amountOut
                || IERC20(p.tokenIn).balanceOf(address(this)) + p.amountIn != beforeIn
        ) revert Underfill();
        uint256 valueA = _quote(tick, IERC20(tokenA).balanceOf(address(this)), tokenA);
        uint256 valueB = IERC20(tokenB).balanceOf(address(this));
        uint256 total = valueA + valueB;
        if (highWaterMark == 0 || total > highWaterMark) {
            highWaterMark = total;
        } else if (
            mandate.maxDrawdownBps > 0
                && total < FullMath.mulDiv(highWaterMark, 10000 - mandate.maxDrawdownBps, 10000)
        ) {
            revert Drawdown();
        }
        // Compare at full precision by rounding the pre-trade ratio up. For an
        // integer post valueA, valueA < ceil(preA * total / preTotal) is exactly
        // the strict fractional comparison, without rounding exposure to bps.
        uint256 threshold = preTotal == 0 ? 0 : FullMath.mulDiv(preA, total, preTotal);
        if (preTotal != 0 && mulmod(preA, total, preTotal) != 0) ++threshold;
        if (valueA > FullMath.mulDiv(total, mandate.maxExposureBps, 10000) && valueA >= threshold) {
            revert Exposure();
        }
    }

    /// @notice Commit WAIT or REJECT under a live mandate without moving funds.
    function commitHold(bytes32 hash, bytes32 prev, Kind kind) external onlyAgent nonReentrant {
        _hold(chain, hash, prev, mandate.policyHash, kind);
    }
}
