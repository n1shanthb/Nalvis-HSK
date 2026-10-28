import { expect, test } from 'vitest';
import { canonical } from '../../core/src/index.js';
import { canonicalCheck } from '../src/canonical-check.js';

test('independent canonicalisers agree on 50 seeded randomized nested objects', () => {
  let seed = 0x76336;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const value = (depth: number): unknown => {
    const n = Math.floor(random() * (depth ? 8 : 6));
    return [
      () => null,
      () => random() > 0.5,
      () => (random() - 0.5) * 1e25,
      () => `escaped\n\t" 😀 ${random()}`,
      () => BigInt(Math.floor(random() * 1e15)),
      () => -0,
      () => [value(depth - 1), value(depth - 1)],
      () => ({
        z: value(depth - 1),
        '\u20ac': value(depth - 1),
        a: value(depth - 1),
      }),
    ][n]();
  };
  for (let i = 0; i < 50; i++) {
    const object = {
      z: value(3),
      a: value(3),
      nested: { b: value(2), a: value(2) },
    };
    expect(canonicalCheck(object)).toBe(canonical(object));
  }
});
test.each([
  NaN,
  Infinity,
  undefined,
  { x: undefined },
  '\ud800',
  '\udc00',
  new Date(),
  new Array(2),
])('both reject unsupported input %#', (value) => {
  expect(() => canonical(value)).toThrow();
  expect(() => canonicalCheck(value)).toThrow();
});
