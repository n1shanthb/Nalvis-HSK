import { describe, it, expect } from 'vitest';
import {
  mulberry32,
  checkMonteCarloRisk,
} from '../src/risk/monteCarlo.js';

describe('Task 8.3: Monte Carlo Risk Check', () => {
  it('1. mulberry32 PRNG is strictly deterministic given same seed', () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    for (let i = 0; i < 50; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('2. mulberry32 PRNG produces numbers in [0, 1)', () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 200; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('3. passes when drawdown is within tolerance', () => {
    const res = checkMonteCarloRisk(100, 0.2, 5, {
      simulations: 200,
      maxDrawdownToleranceBps: 200,
      seed: 42,
    });
    expect(res.passed).toBe(true);
    expect(res.recommendedSizeB).toBe(100);
    expect(res.proposedSizeB).toBe(100);
  });

  it('4. resizes down when volatility causes drawdown violation', () => {
    const res = checkMonteCarloRisk(100, 1.5, -150, {
      simulations: 500,
      maxDrawdownToleranceBps: 50,
      seed: 42,
    });
    expect(res.passed).toBe(false);
    expect(res.recommendedSizeB).toBeLessThan(res.proposedSizeB);
    expect(res.rejectionReason).toBeDefined();
  });

  it('5. strict monotonicity invariant across parameter grid: recommended <= proposed', () => {
    const sizes = [10, 25, 50, 100, 500];
    const vols = [0.05, 0.2, 0.5, 1.0, 2.5];
    const bases = [-500, -100, 0, 50, 200];
    const tolerances = [10, 50, 100, 300];

    for (const size of sizes) {
      for (const vol of vols) {
        for (const basis of bases) {
          for (const tol of tolerances) {
            const result = checkMonteCarloRisk(size, vol, basis, {
              simulations: 50,
              maxDrawdownToleranceBps: tol,
              seed: 1337,
            });
            // Monotonicity assertion
            expect(result.recommendedSizeB).toBeLessThanOrEqual(size);
            expect(result.recommendedSizeB).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});
