import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { reference, round2 } from '../src/backtest/reference.js';
import { replay, measuredCost } from '../src/backtest/engine-replay.js';
import { scenario } from './helpers.js';
const read = (p: string) =>
  JSON.parse(
    readFileSync(
      new URL('../../../data/research/' + p, import.meta.url),
      'utf8',
    ),
  );
it('deep equality with every frozen Python result', () =>
  expect(reference(read('market_history.json').basis_series)).toEqual(
    read('backtest.json'),
  ));
it('Python binary round-half-even', () => {
  expect(round2(2.675)).toBe(2.67);
  expect(round2(2.625)).toBe(2.62);
  expect(round2(2.875)).toBe(2.88);
  expect(round2(-2.675)).toBe(-2.67);
});
it('replay deterministic and fixed measured curve only', () => {
  const h = read('market_history.json').basis_series,
    c = read('hsk_probe.json').mainnet.quotes,
    p = scenario().policy;
  const a = replay(h, c, p);
  expect(a).toEqual(replay(h, c, p));
  expect(a.hours).toBe(720);
  expect(a.label).toContain('no proven edge');
  expect(measuredCost(25, c)).toBeGreaterThan(measuredCost(10, c));
  expect(() => measuredCost(1, c)).toThrow();
}, 20000);
