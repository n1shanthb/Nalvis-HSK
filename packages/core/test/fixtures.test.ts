import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { parseEvidenceJSON } from '../src/serialization.js';
import { canonical, evidenceHash } from '../src/canonical.js';
import { decide } from '../src/engine.js';
import { scenario } from './helpers.js';
it.each(['synthetic-evidence.json', 'recorded-evidence.json'])(
  'recorded pack rehydrates and rehashes: %s',
  (name) => {
    const text = readFileSync(
      new URL('./fixtures/' + name, import.meta.url),
      'utf8',
    ).trim();
    const e = parseEvidenceJSON(text);
    expect(canonical(e)).toBe(text);
    expect(evidenceHash(e)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Object.values(e.sources).filter((s) => s.error)).toEqual([]);
  },
);
it('recorded raw source mutation changes evidence hash', () => {
  const e = parseEvidenceJSON(
    readFileSync(
      new URL('./fixtures/recorded-evidence.json', import.meta.url),
      'utf8',
    ),
  );
  const before = evidenceHash(e);
  e.sources.mexc.raw = { tampered: true };
  expect(evidenceHash(e)).not.toBe(before);
});
it('any collector failure makes engine reject', () => {
  const s = scenario();
  s.e.sources.failure = {
    url: 'fixture:bad',
    method: 'GET',
    raw: null,
    error: 'offline',
    fetchedAt: s.e.now,
  };
  expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('REJECT');
});
