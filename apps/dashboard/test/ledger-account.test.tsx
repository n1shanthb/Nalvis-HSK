import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConnectLedger } from '../src/owner/ConnectLedger.js';
import { LedgerProvider } from '../src/owner/LedgerContext.js';
import type { connectLedger } from '../src/owner/ledger.js';

it('connects account 3 at index 2 and clears its address when switching accounts', async () => {
  const owner = '0xE0B9226b1488E6293D4A8FD4E1720d35eaf80419';
  const disconnect = vi.fn();
  const factory = vi.fn(async () => ({ address: async () => owner, disconnect, signTransaction: vi.fn() }));
  render(<LedgerProvider><ConnectLedger vault={owner} signerFactory={factory as unknown as typeof connectLedger} readOwner={async () => owner} /></LedgerProvider>);
  fireEvent.change(screen.getByLabelText('Ledger account'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect Ledger' }));
  await waitFor(() => expect(screen.getByText('Owner ✓')).toBeTruthy());
  expect(factory).toHaveBeenCalledWith(133, 2);
  expect(disconnect).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText('Ledger account'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: 'Connect Ledger' })).toBeTruthy();
  expect(screen.queryByText('Owner ✓')).toBeNull();
});
