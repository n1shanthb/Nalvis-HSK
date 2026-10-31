import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { addresses } from '../../../packages/core/src/addresses.js';
import { readVault } from '../src/lib/clients.js';
import { MandateDetails } from '../src/views/Mandate.js';
import { OwnerActions } from '../src/owner/OwnerActions.js';
import { snapshot, vault } from './ux-fixtures.js';
test('vault tokens drive decimal/balance reads and mismatches are visible', async () => {
  const tokenA = addresses[177].whsk.address,
    tokenB = addresses[133].usdt.address;
  const readContract = vi.fn(
    async (p: { functionName: string; address: string }) => {
      if (p.functionName === 'tokenA') return tokenA;
      if (p.functionName === 'tokenB') return tokenB;
      if (p.functionName === 'owner') return snapshot.owner;
      if (p.functionName === 'paused') return false;
      if (p.functionName === 'mandate') return Object.values(snapshot.mandate);
      if (p.functionName === 'decimals') return p.address === tokenA ? 18 : 6;
      if (p.functionName === 'balanceOf') return 10n ** 18n;
    },
  );
  const result = await readVault(133, vault, {
    getChainId: async () => 133,
    getBlockNumber: async () => 42n,
    readContract,
  } as never);
  expect(result.tokenMismatch).toBe(true);
  expect(result.tokenA).toBe(tokenA);
  expect(result.decimalsB).toBe(6);
  expect(readContract).toHaveBeenCalledWith(
    expect.objectContaining({
      address: tokenA,
      functionName: 'decimals',
      blockNumber: 42n,
    }),
  );
  render(<MandateDetails snapshot={result} />);
  expect(screen.getByRole('alert').textContent).toContain(
    'Vault token mismatch',
  );
});
test('withdraw rejects an amount above the loaded balance before Ledger access', () => {
  render(
    <OwnerActions
      chain={133}
      vault={vault}
      snapshot={{
        ...snapshot,
        tokenA: addresses[133].whsk.address,
        tokenB: addresses[133].usdt.address,
        balanceA: 1n,
        balanceB: 1n,
      }}
    />,
  );
  const input = screen.getByLabelText('Amount') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '2' } });
  fireEvent.click(screen.getByText('Review withdrawal'));
  expect(screen.getByRole('status').textContent).toContain(
    'exceeds the vault balance',
  );
  expect(screen.queryByText('Sign reviewed action on Ledger')).toBeNull();
});
