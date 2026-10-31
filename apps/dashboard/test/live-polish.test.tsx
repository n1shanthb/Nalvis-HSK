import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { VerifyView, recordedTrade } from '../src/views/Verify.js';
import { CoinGeckoReference } from '../src/components/CoinGeckoReference.js';
import * as receipts from '../src/lib/receipts.js';
test('a transaction deep link starts verification without a submit click', async () => {
  const lookup = vi.spyOn(receipts, 'localReceipts').mockResolvedValue([]);
  window.history.replaceState(
    null,
    '',
    `/#/verify?tx=${recordedTrade.settlement.transactionHash}`,
  );
  render(<VerifyView chain={133} />);
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Matching receipt JSON unavailable. Paste the keeper receipt below.',
  );
  expect(lookup).toHaveBeenCalledOnce();
  window.history.replaceState(null, '', '/');
});
test('CoinGecko reference is labelled USD with four decimal places', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ 'hashkey-ecopoints': { usd: 0.086894 } }),
  );
  render(<CoinGeckoReference />);
  expect(await screen.findByText('0.0869 USD')).toBeTruthy();
});
