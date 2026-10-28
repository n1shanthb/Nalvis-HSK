import { keccak256, toBytes } from 'viem';

/** JCS key ordering and ECMAScript number formatting, extended with decimal bigint strings. */
export function canonical(value: unknown): string {
  const active = new Set<object>();
  function encode(v: unknown): string {
    if (typeof v === 'bigint') return JSON.stringify(v.toString());
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') {
      if (
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          v,
        )
      )
        throw new Error('Unpaired surrogate');
      return JSON.stringify(v);
    }
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null)
      throw new Error('Not canonical JSON');
    if (active.has(v)) throw new Error('Cyclic JSON');
    active.add(v);
    let result: string;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        throw new Error('Sparse or extended array');
      result = '[' + Array.from(v, encode).join(',') + ']';
    } else {
      if (
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        throw new Error('Not a plain object');
      if (Object.getOwnPropertySymbols(v).length) throw new Error('Symbol key');
      result =
        '{' +
        Object.keys(v)
          .sort()
          .map(
            (k) => encode(k) + ':' + encode((v as Record<string, unknown>)[k]),
          )
          .join(',') +
        '}';
    }
    active.delete(v);
    return result;
  }
  return encode(value);
}
export const hash = (value: unknown) => keccak256(toBytes(canonical(value)));
export const evidenceHash = hash;
