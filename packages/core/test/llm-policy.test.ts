import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonical } from '../src/canonical.js';
import { keccak256, toBytes } from 'viem';
import {
  choosePreset,
  DeterministicChooser,
  OpenAICompatibleChooser,
  nlToParamDiff,
} from '../src/llm.js';
import {
  clampToMandate,
  policySchema,
  policyHash,
  units,
} from '../src/policy.js';
import { scenario } from './helpers.js';
it('safe default and fake chooser', async () => {
  expect((await choosePreset('summary', ['balanced'])).preset).toBe('balanced');
  expect(
    (
      await choosePreset('x', ['patient'], {
        choose: () => ({ preset: 'patient', explanation: 'fake' }),
      })
    ).valid,
  ).toBe(true);
  expect(
    new DeterministicChooser().choose('', ['conservative']).explanation,
  ).toContain('conservative');
});
it.each([
  { preset: 'invalid', explanation: 'x' },
  { preset: 'patient', explanation: 'x' },
  { preset: 'balanced', explanation: 'x', amount: 100 },
  null,
])('invalid enum, disallowed and extra output rejected %#', async (output) => {
  const r = await choosePreset('x', ['balanced'], { choose: () => output });
  expect(r.valid).toBe(false);
  expect(r.preset).toBe('balanced');
  expect(r.ruleTrace[0].rule).toBe('llm_invalid');
});
it('chooser failures fall back; empty allowed set refused', async () => {
  expect(
    (
      await choosePreset('x', ['balanced'], {
        choose: () => {
          throw Error('fake');
        },
      })
    ).valid,
  ).toBe(false);
  await expect(choosePreset('x', [])).rejects.toThrow();
});
it('no key uses deterministic chooser without network', async () => {
  const c = new OpenAICompatibleChooser('unused', 'fake', '', () => {
    throw Error('No network');
  });
  expect(await c.choose('x', ['balanced'])).toEqual({
    preset: 'balanced',
    explanation: 'Using balanced within the signed mandate.',
  });
});
it('natural language refuses mandate widening', () => {
  const s = scenario();
  expect(nlToParamDiff('maxTradeIn to 101', s.policy, s.mandate).refused).toBe(
    'requires new Ledger-signed mandate',
  );
  expect(nlToParamDiff('maxTradeInB = 50', s.policy, s.mandate).diff).toEqual({
    maxTradeInB: units(50, 6).toString(),
  });
  expect(
    nlToParamDiff('be more conservative', s.policy, s.mandate).diff,
  ).toEqual({ preset: 'conservative' });
  expect(nlToParamDiff('send a trade', s.policy, s.mandate).diff).toEqual({});
});
it('validate every preset against envelope', () => {
  const s = scenario();
  expect(clampToMandate(s.policy, s.mandate, 6)).toEqual(s.policy);
  s.policy.presets.patient.sizeGridB = [101];
  expect(() => clampToMandate(s.policy, s.mandate, 6)).toThrow(
    'requires new Ledger-signed mandate',
  );
});
it('JCS policy file bytes match policy hash for Solidity helper', () => {
  const s = scenario();
  expect(policySchema.parse(s.policy)).toEqual(s.policy);
  const bytes = readFileSync(
    new URL('../../../policy/default.json', import.meta.url),
    'utf8',
  );
  expect(bytes).toBe(canonical(s.policy));
  expect(policyHash(s.policy)).toBe(keccak256(toBytes(bytes)));
});
