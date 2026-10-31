import { it, expect } from 'vitest';
import { decide } from '../src/engine.js';
import { riskCheck } from '../src/risk.js';
import { scenario } from './helpers.js';
const prepare = () => {
  const s = scenario();
  s.e.validUntil = s.e.now + 120;
  s.e.riskInput = {
    sigma: 0.0045,
    observations: 719,
    historyHash: '0x' + 'a'.repeat(64),
  };
  return s;
};
it('replays endpoint worst-case stress deterministically, preserving the requested size ceiling', () => {
  const s = prepare();
  const d = decide(s.e, s.policy, s.mandate, s.state);
  expect(d.kind).toBe('TRADE');
  expect(d.validUntil).toBe(s.e.now + 120);
  expect(d.riskCheck?.samples).toBe(2);
  expect(decide(s.e, s.policy, s.mandate, s.state)).toEqual(d);
});
it('rejects every size when historical sigma consumes the edge', () => {
  const s = prepare();
  s.e.riskInput!.sigma = 0.1;
  const d = decide(s.e, s.policy, s.mandate, s.state);
  expect(d.kind).toBe('REJECT');
  expect(d.riskCheck?.accepted).toBe(false);
});
it('only resizes down when the larger cost curve fails stress', () => {
  const s = prepare();
  s.e.quotes.find(
    (q) => q.direction === 'BUY_A' && q.sizeB === 100,
  )!.quotedOut = 98500000000000000000n;
  const d = decide(s.e, s.policy, s.mandate, s.state);
  expect(d.kind).toBe('RESIZE');
  expect(d.sizeB).toBeLessThan(100);
});
it('requires historical volatility and policy-bound expiry for new evidence', () => {
  const s = prepare();
  delete s.e.riskInput;
  expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('REJECT');
  s.e.validUntil = s.e.validUntil! + 1;
  expect(decide(s.e, s.policy, s.mandate, s.state).ruleTrace[0].rule).toBe(
    'decision_expiry',
  );
});
it('includes sigma endpoints and never mutates quotes', () => {
  const s = prepare(),
    q = s.e.quotes[0],
    before = structuredClone(q);
  const r = riskCheck(s.e, q, 0);
  expect(r.worstCostBps).toBeGreaterThan(0);
  expect(q).toEqual(before);
});

it('new decisions cannot omit both expiry and volatility', () => {
  const s = prepare();
  delete s.e.validUntil;
  delete s.e.riskInput;
  expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('REJECT');
});
it('stress equals independent endpoint calculation for every quote', () => {
  const s = prepare();
  for (const q of s.e.quotes) {
    const buy = q.direction === 'BUY_A';
    const fair =
      (Number(q.amountIn) / 10 ** (buy ? s.e.decimalsB : s.e.decimalsA)) *
      (buy ? 1 / s.e.dexMid! : s.e.dexMid!);
    const out =
      Number(q.quotedOut) / 10 ** (buy ? s.e.decimalsA : s.e.decimalsB);
    const expected = Math.max(
      0,
      ...[-s.e.riskInput!.sigma, s.e.riskInput!.sigma].map(
        (shock) =>
          (1 - out / (fair * (buy ? 1 / (1 + shock) : 1 + shock))) * 10000,
      ),
    );
    expect(riskCheck(s.e, q, 0)).toMatchObject({
      method: 'sigma-worst-case-v1',
      samples: 2,
      worstCostBps: expected,
    });
  }
});

it('server-ahead skew does not expire a live chain-clock mandate', () => {
  const s = prepare();
  s.mandate.expiry = s.e.decisionTime! + 3;
  s.e.now += 5;
  s.e.apro!.ageSec = 5;
  expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('TRADE');
});
