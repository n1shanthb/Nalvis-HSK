import { z } from 'zod';
import { evidenceSchema, type Evidence } from './types.js';

const object = z.record(z.unknown());
const integer = z.union([
  z.bigint(),
  z.string().regex(/^\d+$/).transform(BigInt),
]);
/** Restore only schema-declared integer fields. Raw payloads remain verbatim JSON. */
export function parseEvidenceJSON(text: string): Evidence {
  const data = object.parse(JSON.parse(text));
  const restore = (value: unknown, keys: string[]) => {
    const row = object.parse(value);
    for (const key of keys)
      if (row[key] !== undefined) row[key] = integer.parse(row[key]);
    return row;
  };
  const e = restore(data, ['blockNumber', 'executionBlockNumber']);
  e.quotes = z
    .array(z.unknown())
    .parse(e.quotes)
    .map((q) => restore(q, ['amountIn', 'quotedOut', 'twapFloor']));
  e.sources = Object.fromEntries(
    Object.entries(object.parse(e.sources)).map(([k, s]) => [
      k,
      restore(s, ['blockNumber']),
    ]),
  );
  if (e.vault !== undefined) {
    const v = restore(e.vault, ['balanceA', 'balanceB']);
    v.mandate = restore(v.mandate, [
      'maxTradeInA',
      'maxTradeInB',
      'maxDailyInB',
    ]);
    e.vault = v;
  }
  return evidenceSchema.parse(e);
}
