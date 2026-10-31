import { readFileSync, readdirSync } from 'node:fs';
import { it, expect } from 'vitest';
import { verify } from '../src/verify.js';
import { recordedReader } from '../src/recorded.js';
import { hash, receiptHash } from '../../core/src/index.js';
const dir = new URL('./fixtures/t8/', import.meta.url);
const chain = JSON.parse(readFileSync(new URL('chain.json', dir), 'utf8'));
const receipts = readdirSync(new URL('receipts/', dir))
  .map((f) => JSON.parse(readFileSync(new URL('receipts/' + f, dir), 'utf8')))
  .sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq)));
it.each(receipts.map((r) => [r.decision.kind, r] as const))(
  'real v2 %s receipt verifies with committed chain expiry and stress',
  async (_kind, r) => {
    expect(r.version).toBe(2);
    expect(r.evidence.validUntil).toBe(r.evidence.decisionTime + 120);
    expect(r.evidence.sources.volatilityHistory.raw.asOf).toContain(
      '27/10/2026',
    );
    expect(r.evidence.sources.riskStress.method).toBe('sigma-worst-case-v1');
    if (['TRADE', 'RESIZE'].includes(r.decision.kind))
      expect(r.decision.riskCheck).toMatchObject({
        method: 'sigma-worst-case-v1',
        samples: 2,
      });
    const result = await verify(r, recordedReader(chain), { chain: 4 });
    expect(result.checks.filter((c) => !c.pass)).toEqual([]);
    expect(result.status).toBe('PASS');
  },
);
it.each(['decision', 'policy', 'minOut', 'strip', 'downgrade'])(
  'v2 rehashed %s cannot bypass verification',
  async (kind) => {
    const r = structuredClone(receipts[0]);
    if (kind === 'decision') r.decision.sizeB = 1;
    if (kind === 'policy')
      r.evidence.sources.replay.raw.policy.dailyLossStopB++;
    if (kind === 'minOut') r.tx.minOut = String(BigInt(r.tx.minOut) + 1n);
    if (kind === 'strip' || kind === 'downgrade') {
      delete r.evidence.validUntil;
      delete r.evidence.riskInput;
      delete r.decision.validUntil;
      delete r.decision.riskCheck;
      delete r.tx.validUntil;
    }
    if (kind === 'downgrade') r.version = 1;
    r.evidenceHash = hash(r.evidence);
    r.receiptHash = receiptHash(r);
    const result = await verify(r, recordedReader(chain));
    expect(result.status).toBe('FAIL');
    expect(result.checks.find((c) => !c.pass)?.name).toBe(
      (
        {
          decision: 'decision_replay',
          policy: 'policyHash',
          minOut: 'event_receiptHash',
          strip: 'receipt_schema',
          downgrade: 'receipt_version',
        } as Record<string, string>
      )[kind],
    );
  },
);
