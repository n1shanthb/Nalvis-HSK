import { expect, test, vi } from 'vitest';
import { BaseError } from 'viem';
import { humanError } from '../src/lib/errors.js';
test.each([
  [0x6985, 'Transaction rejected on Ledger'],
  [0x5515, 'Unlock your Ledger'],
  [0x6e00, 'Open the Ethereum app'],
  [0x6d00, 'Open the Ethereum app'],
  [0x6a80, 'Enable Blind signing'],
])('Ledger status %s is explained', (statusCode, message) => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  expect(humanError({ cause: { statusCode } })).toContain(message);
});
test.each([
  ['Unauthorized', 'current vault owner'],
  ['InvalidMandate', 'mandate is invalid'],
  ['Inactive', 'paused, revoked or expired'],
  ['TradeCap', 'per-trade mandate cap'],
  ['Interval', 'minimum trade interval'],
  ['Drawdown', 'drawdown circuit breaker'],
  ['DecisionExpired', 'decision expired'],
])('nested %s contract revert is explained', (errorName, explanation) => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  expect(humanError({ cause: { data: { errorName } } })).toContain(explanation);
  expect(humanError({ cause: { data: { errorName } } })).not.toContain(
    'Details:',
  );
});
test('short viem errors and browser failures stay one line', () => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  expect(
    humanError(
      new BaseError('RPC unavailable', { details: 'long internal details' }),
    ),
  ).toBe('RPC unavailable');
  expect(humanError(new DOMException('denied', 'NotAllowedError'))).toContain(
    'permission was denied',
  );
  expect(humanError(Error('WebHID is unavailable'))).toContain('Chrome/Edge');
});

// Synthetic diagnostic hex only; none of these values is used on a chain.
test.each(['6985', '5515', '6e00', '6d00', '6a80'])(
  'diagnostic hex containing %s is not a Ledger status',
  (code) => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const hash = `0x${'a'.repeat(20)}${code}${'b'.repeat(40)}`;
    const address = `0x${'c'.repeat(16)}6a80${'d'.repeat(20)}`;
    const message = `Receipt timeout for ${hash} at ${address}`;
    expect(humanError(new Error(`${message}\nRPC diagnostics`))).toBe(message);
    const error = new BaseError('Receipt confirmation timed out', {
      details: `tx ${hash}, to ${address}`,
    });
    expect(humanError(error)).toBe(error.shortMessage);
  },
);
test.each([0x6985, 0x5515, 0x6e00, 0x6d00, 0x6a80])(
  'numeric statusWord %s retains the statusCode mapping',
  (status) => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(humanError({ originalError: { statusWord: status } })).toBe(
      humanError({ cause: { statusCode: status } }),
    );
  },
);
test.each(['0x6985', '6985', '0x6a80'])(
  'string status %s is not treated as a numeric Ledger status',
  (status) => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(
      humanError({
        shortMessage: 'RPC unavailable',
        cause: { statusCode: status, statusWord: status },
      }),
    ).toBe('RPC unavailable');
  },
);
test.each([
  ['UserRefusedOnDevice', 'Transaction rejected on Ledger'],
  ['RefusedByUserDAError', 'Transaction rejected on Ledger'],
  ['LockedDeviceError', 'Unlock your Ledger'],
  ['DeviceLockedError', 'Unlock your Ledger'],
])('exact Ledger error name/type %s is recognized', (name, message) => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  for (const typed of [{ name }, { _tag: name }, { constructor: { name } }])
    expect(humanError({ cause: typed })).toContain(message);
});
test('rejection text is limited to explicit user phrases', () => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  for (const phrase of ['user rejected', 'denied by the user'])
    expect(humanError(Error(phrase))).toContain(
      'Transaction rejected on Ledger',
    );
  expect(
    humanError(Error('RPC rejected a transaction from user service')),
  ).toBe('RPC rejected a transaction from user service');
  expect(humanError(Error('RPC status 0x6985 or statusCode 6985'))).toBe(
    'RPC status 0x6985 or statusCode 6985',
  );
});
