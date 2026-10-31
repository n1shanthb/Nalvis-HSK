import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { canonical, hash, evidenceHash } from '../src/canonical.js';
import { buildReceipt, receiptHash } from '../src/receipt.js';
import { decide } from '../src/engine.js';
import { addresses } from '../src/addresses.js';
import { scenario } from './helpers.js';
export function receiptScenario() {
  const s = scenario();
  return buildReceipt({
    contract: addresses[133].primaryPool.address,
    seq: 0n,
    prevHead: ('0x' + '00'.repeat(32)) as `0x${string}`,
    policy: s.policy,
    evidence: s.e,
    decision: decide(s.e, s.policy, s.mandate, s.state),
    llm: { explanation: 'Synthetic golden fixture' },
    tx: {
      to: addresses[133].primaryPool.address,
      data: '0x',
      minOut: 0n,
      deadline: s.e.now + 60,
      nonce: 0n,
    },
  });
}
it('canonical JCS extension golden', () => {
  expect(canonical({ z: [1n, -0, 1e30], a: '£\n' })).toBe(
    '{"a":"£\\n","z":["1",0,1e+30]}',
  );
  expect(hash({ b: 2, a: 1 })).toBe(
    '0xb8ffb64722137f4b100665a52e3c943f8066e8ab8ba3b427e6f4b404defd82b0',
  );
});
it.each([
  NaN,
  Infinity,
  undefined,
  { a: undefined },
  [undefined],
  new Date(),
  () => 0,
  Symbol(),
  { a: '\ud800' },
])('reject invalid canonical JSON %#', (v) =>
  expect(() => canonical(v)).toThrow(),
);
it('cycle and sparse array rejected', () => {
  const a: unknown[] = [];
  a.push(a);
  expect(() => canonical(a)).toThrow();
  expect(() => canonical(Array(2))).toThrow();
});
it('stable decision and receipt across 100 runs', () => {
  const s = scenario(),
    d = decide(s.e, s.policy, s.mandate, s.state),
    r = receiptScenario();
  for (let i = 0; i < 100; i++) {
    expect(decide(s.e, s.policy, s.mandate, s.state)).toEqual(d);
    expect(receiptScenario().receiptHash).toBe(r.receiptHash);
  }
  const old = evidenceHash(s.e);
  s.e.sources.fixture.raw = 'one changed byte';
  expect(evidenceHash(s.e)).not.toBe(old);
}, 20000);
it('freeze exact receipt fields and hash in golden file', () => {
  expect(canonical(receiptScenario())).toBe(
    readFileSync(
      new URL('./fixtures/receipt.golden.json', import.meta.url),
      'utf8',
    ).trim(),
  );
});
it('only calldata is omitted from hash; deadline, nonce and recipient committed', () => {
  const r = receiptScenario();
  expect(receiptHash({ ...r, tx: { ...r.tx, data: '0x1234' } })).toBe(
    r.receiptHash,
  );
  expect(
    receiptHash({ ...r, tx: { ...r.tx, deadline: r.tx.deadline + 1 } }),
  ).not.toBe(r.receiptHash);
});
