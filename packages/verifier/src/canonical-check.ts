/** Independent JCS implementation; deliberately does not import the core encoder. */
export function canonicalCheck(input: unknown): string {
  const parents: object[] = [];
  function visit(value: unknown): string {
    if (typeof value === 'bigint') return JSON.stringify(String(value));
    if (typeof value === 'string') {
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = value.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff))
            throw Error('Unpaired surrogate');
        } else if (c >= 0xdc00 && c <= 0xdfff)
          throw Error('Unpaired surrogate');
      }
      return JSON.stringify(value);
    }
    if (value === null || typeof value === 'boolean')
      return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw Error('Non-finite number');
      return JSON.stringify(value);
    }
    if (typeof value !== 'object') throw Error('Unsupported JSON value');
    if (parents.includes(value)) throw Error('Cyclic JSON');
    parents.push(value);
    let encoded: string;
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length)
        throw Error('Invalid array');
      encoded = '[' + Array.from(value, visit).join(',') + ']';
    } else {
      const proto = Object.getPrototypeOf(value);
      if (
        (proto !== null && proto !== Object.prototype) ||
        Object.getOwnPropertySymbols(value).length
      )
        throw Error('Invalid object');
      const row = value as Record<string, unknown>;
      encoded =
        '{' +
        Object.keys(row)
          .sort()
          .map((key) => visit(key) + ':' + visit(row[key]))
          .join(',') +
        '}';
    }
    parents.pop();
    return encoded;
  }
  return visit(input);
}
