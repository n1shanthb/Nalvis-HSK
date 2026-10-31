import { canonical } from '../../../../packages/core/src/canonical.js';
import { parseEvidenceJSON } from '../../../../packages/core/src/serialization.js';
import {
  policySchema,
  mandateSchema,
} from '../../../../packages/core/src/policy.js';
import {
  receiptSchema,
  verify,
} from '../../../../packages/verifier/src/verify.js';
import { recordedReader } from '../../../../packages/verifier/src/recorded.js';
import { pnl } from '../../../../packages/verifier/src/pnl.js';
import recording from '../../../../packages/verifier/test/fixtures/chain.json';
const files = import.meta.glob(
  '../../../../packages/verifier/test/fixtures/receipts/*.json',
  { eager: true, import: 'default' },
);
export const demoReceipts = Object.values(files)
  .map((r) => receiptSchema.parse(r))
  .sort((a, b) => (a.seq < b.seq ? -1 : 1));
export const demoEvidence = demoReceipts.map((r) =>
  parseEvidenceJSON(canonical(r.evidence)),
);
export async function demoContext() {
  const results = await Promise.all(
    demoReceipts.map((r) => verify(r, recordedReader(recording))),
  );
  const raw = demoEvidence[0].sources.replay.raw as {
    policy: unknown;
    mandate: Record<string, unknown>;
  };
  const mandate = mandateSchema.parse({
    ...raw.mandate,
    ...Object.fromEntries(
      ['maxTradeInA', 'maxTradeInB', 'maxDailyInB'].map((k) => [
        k,
        BigInt(String(raw.mandate[k])),
      ]),
    ),
  });
  return {
    results,
    portfolio: pnl(results),
    receipts: demoReceipts,
    evidence: demoEvidence[0],
    policy: policySchema.parse(raw.policy),
    mandate,
  };
}
