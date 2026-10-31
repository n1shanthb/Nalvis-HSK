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
test.each(['Unauthorized', 'InvalidMandate', 'Inactive'])(
  'nested %s contract revert is explained',
  (errorName) => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(humanError({ cause: { data: { errorName } } })).not.toContain(
      'undefined',
    );
    expect(humanError({ cause: { data: { errorName } } })).not.toContain(
      'Details:',
    );
  },
);
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
