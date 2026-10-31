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
