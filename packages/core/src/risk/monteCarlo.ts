/**
 * Deterministic pseudo-random number generator (Mulberry32).
 * Produces deterministic, reproducible floating point numbers in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = Math.floor(seed);
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarloConfig {
  simulations?: number;
  timeHorizonSec?: number;
  seed?: number;
  maxDrawdownToleranceBps?: number;
}

export interface MonteCarloRiskResult {
  passed: boolean;
  proposedSizeB: number;
  recommendedSizeB: number;
  worstDrawdownBps: number;
  p95DrawdownBps: number;
  rejectionReason?: string;
}

/**
 * Monte Carlo Risk Check.
 * Runs deterministic simulations of basis and price trajectories
 * to verify risk and cap sizes.
 *
 * CRITICAL INVARIANT: Monotonicity
 * recommendedSizeB <= proposedSizeB under all branches and conditions.
 */
export function checkMonteCarloRisk(
  proposedSizeB: number,
  volatilityAnnualized: number,
  currentBasisBps: number,
  config: MonteCarloConfig = {},
): MonteCarloRiskResult {
  const sims = config.simulations ?? 500;
  const horizonSec = config.timeHorizonSec ?? 300; // 5 min
  const maxDDBps = config.maxDrawdownToleranceBps ?? 200; // 2%
  const prng = mulberry32(config.seed ?? 42);

  // Time step in years (365 days)
  const dt = horizonSec / (365 * 24 * 3600);
  const sigma = Math.max(0.01, volatilityAnnualized);

  const drawdowns: number[] = [];

  for (let i = 0; i < sims; i++) {
    // Generate Box-Muller standard normal
    const u1 = Math.max(1e-7, prng());
    const u2 = prng();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    // Simulated price return over horizon
    const priceReturn = z * sigma * Math.sqrt(dt);

    // Basis reversion shock (mean reverting towards 0)
    const basisShock = (currentBasisBps / 10000) * 0.5 + priceReturn;
    const simDrawdownBps = Math.max(0, -basisShock * 10000);
    drawdowns.push(simDrawdownBps);
  }

  drawdowns.sort((a, b) => a - b);
  const p95Idx = Math.min(drawdowns.length - 1, Math.floor(sims * 0.95));
  const p95DrawdownBps = Math.round(drawdowns[p95Idx]);
  const worstDrawdownBps = Math.round(drawdowns[drawdowns.length - 1]);

  if (p95DrawdownBps > maxDDBps) {
    // Scale down proportionally to risk tolerance
    const scaleFactor = Math.max(0, maxDDBps / p95DrawdownBps);
    let recommended = proposedSizeB * scaleFactor;

    // Discretize or round down
    recommended = Math.floor(recommended * 100) / 100;

    // Strict monotonicity assertion
    if (recommended > proposedSizeB) {
      recommended = proposedSizeB;
    }

    return {
      passed: false,
      proposedSizeB,
      recommendedSizeB: recommended,
      worstDrawdownBps,
      p95DrawdownBps,
      rejectionReason: `P95 simulated drawdown ${p95DrawdownBps} bps exceeds tolerance ${maxDDBps} bps`,
    };
  }

  // Under normal conditions, proposed size is accepted
  const recommended = proposedSizeB;

  // Strict monotonicity assertion: recommendedSize <= proposedSize
  return {
    passed: true,
    proposedSizeB,
    recommendedSizeB: Math.min(recommended, proposedSizeB),
    worstDrawdownBps,
    p95DrawdownBps,
  };
}
