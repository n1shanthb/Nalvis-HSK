import { it, expect } from 'vitest';
import { zeroHash } from 'viem';
import { localVault, hasAnvil } from './anvil.js';
import { check, type Prepared } from '../../src/agent/mandate-check.js';
import { action, unit } from './fixtures.js';
import { twapOutput } from '../../src/agent/twap.js';
it.skipIf(!hasAnvil)(
  'anvil: 240 seeded random action/state cases agree with actual eth_call',
  async () => {
    const h = await localVault();
    let seed = 12012;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    let successes = 0,
      failures = 0;
    try {
      for (let i = 0; i < 240; i++) {
        const tick = Number(random() % 2001) - 1000;
        await h.write(h.pool, 'setTick', [tick, 0]);
        const cap = BigInt(1 + (random() % 200)) * unit;
        await h.write(h.vault, 'setMandate', [
          {
            ...h.mandate,
            maxTradeInA: cap,
            maxTradeInB: cap,
            maxDailyInB: BigInt(1 + (random() % 300)) * unit,
            maxExposureBps: Number(random() % 10001),
            maxDrawdownBps: Number(random() % 1001),
          },
        ]);
        const variation = i % 12;
        if (variation === 2) await h.write(h.vault, 'pause');
        if (variation === 3) await h.write(h.pool, 'setFail', [true]);
        if (variation === 4) await h.write(h.vault, 'revoke');
        const a = action(
          String(1 + (random() % 220)),
          random() % 2 ? 'BUY' : 'SELL',
        );
        // Router matches the TWAP approximately; expected output is independently its actual rational fill.
        const price = twapOutput(
          tick,
          unit,
          BigInt(a.type === 'BUY' ? h.tokenB.address : h.tokenA.address) <
            BigInt(a.type === 'BUY' ? h.tokenA.address : h.tokenB.address),
        );
        await h.write(h.router, 'setPrice', [price, unit]);
        const fresh = await h.state(),
          q = await h.quote(a, fresh);
        const override: Partial<Prepared> = {};
        if (variation === 5) override.nonce = fresh.nextNonce + 1n;
        if (variation === 6)
          override.prevHead = ('0x' + '2'.repeat(64)) as `0x${string}`;
        if (variation === 7) override.deadline = fresh.blockTime - 1;
        if (variation === 8) override.validUntil = fresh.blockTime - 1;
        if (variation === 9) override.minOut = 0n;
        if (variation === 10) override.minOut = q.amountOut + 1n;
        const c = check(a, fresh, q, override),
          sim = await h.simulate(fresh, c.prepared, zeroHash);
        expect({
          i,
          violations: c.violations.map((v) => v.limit),
          simulation: sim.error,
          ok: c.ok,
        }).toMatchObject({ ok: sim.ok });
        if (c.ok) successes++;
        else failures++;
        if (variation === 2) await h.write(h.vault, 'unpause');
        if (variation === 3) await h.write(h.pool, 'setFail', [false]);
      }
      expect(successes).toBeGreaterThan(10);
      expect(failures).toBeGreaterThan(100);
    } finally {
      await h.stop();
    }
  },
  600000,
);
