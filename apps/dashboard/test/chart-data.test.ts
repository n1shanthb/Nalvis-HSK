// @vitest-environment node
import { describe, expect, it } from 'vitest';
import history from '../../../data/research/market_history.json';
import {
  basisPct,
  cexMid,
  decisionMarkers,
  exposure,
  insideEngineBand,
  loadHistory,
  spendByDay,
  utilisation,
  vaultSeries,
} from '../src/lib/chart-data.js';
import { demoContext } from '../src/lib/demo.js';
import type { ActionView } from '../src/agent/feed-types.js';
import { decide } from '../../../packages/core/src/engine.js';
import { scenario } from '../../../packages/core/test/helpers.js';
describe('chart data uses measured observations', () => {
  it('calculates both venue mids and basis; missing venue stays missing', () => {
    expect(
      cexMid({
        cex: [
          { venue: 'mexc', bid: 9, ask: 11, fetchedAt: 1 },
          { venue: 'gate', bid: 11, ask: 13, fetchedAt: 1 },
        ],
      }),
    ).toBe(11);
    expect(cexMid({ cex: [] })).toBeUndefined();
    expect(basisPct(11, 10)).toBeCloseTo(10);
  });
  it('validates all 720 frozen observations and rejects malformed or unordered rows', () => {
    expect(loadHistory(history)).toHaveLength(720);
    expect(() =>
      loadHistory({
        basis_series: [{ hour: 1, dex: 0, cex: 1, basis_pct: 0 }],
      }),
    ).toThrow();
    expect(() =>
      loadHistory({
        basis_series: [
          { hour: 2, dex: 1, cex: 1, basis_pct: 0 },
          { hour: 1, dex: 1, cex: 1, basis_pct: 0 },
        ],
      }),
    ).toThrow();
  });
  it('matches the actual engine at and outside the portfolio weight band', () => {
    for (const balanceA of [100n, 900n, 2000n]) {
      const s = scenario();
      s.state.balanceA = balanceA * 10n ** 18n;
      const a = (Number(s.state.balanceA) / 1e18) * s.e.dexMid!,
        b = Number(s.state.balanceB) / 1e6;
      const inside = insideEngineBand(
        a / (a + b),
        s.policy.presets.balanced.targetWeightA,
        s.policy.presets.balanced.bandBps,
      );
      const decision = decide(s.e, s.policy, s.mandate, s.state);
      expect(decision.ruleTrace.some((r) => r.rule === 'band' && r.pass)).toBe(
        inside,
      );
    }
    expect(insideEngineBand(0.25, 0, 2500)).toBe(true);
    expect(insideEngineBand(0.250001, 0, 2500)).toBe(false);
  });
  it('maps every decision with symbol, text, chronology and receipt link', () => {
    const markers = decisionMarkers(
      ['TRADE', 'RESIZE', 'WAIT', 'REJECT'].map(
        (kind, i) =>
          ({ at: 10 - i, final: { kind }, txHash: '0x123' }) as ActionView,
      ),
    );
    expect(markers.map((m) => m.text)).toEqual([
      '✕ REJECT',
      '○ WAIT',
      '◆ RESIZE',
      '▲ TRADE',
    ]);
    expect(markers[0].href).toBe('#/verify?tx=0x123');
  });
  it('calculates exposure and cap thresholds at 80% and 100%', () => {
    expect(exposure(5n, 5n, 0, 0, 1)).toBe(5000);
    for (const cap of [100, 5000, 1000]) {
      expect(utilisation(cap * 0.79, cap).tone).toBe('ok');
      expect(utilisation(cap * 0.8, cap).tone).toBe('warning');
      expect(utilisation(cap, cap).tone).toBe('danger');
    }
    expect(utilisation(undefined, 100).ratio).toBeUndefined();
  });
  it('aggregates spend at the IST midnight boundary', () => {
    const at = Date.parse('2026-10-31T18:30:00Z') / 1000;
    expect(
      spendByDay(
        [
          { at: at - 1, usd: 0.2 },
          { at, usd: 0.3 },
        ],
        at,
      ).slice(-2),
    ).toEqual([
      { day: '2026-10-31', usd: 0.2 },
      { day: '2026-11-01', usd: 0.3 },
    ]);
  });
  it('reconstructs every verified receipt prefix after gas with the recorded ending value', async () => {
    const c = await demoContext(),
      rows = vaultSeries(c.results);
    expect(rows).toHaveLength(c.results.length);
    expect(rows.at(-1)!.vault).toBeCloseTo(
      c.portfolio.portfolioUSD - c.portfolio.gasUSD,
      8,
    );
    expect(c.portfolio.portfolioUSD).toBeCloseTo(902.58, 2);
    expect(rows.at(-1)!.hold).toBe(c.portfolio.holdUSD);
    expect(() => vaultSeries([{ status: 'FAIL' } as never])).toThrow();
  });
});
