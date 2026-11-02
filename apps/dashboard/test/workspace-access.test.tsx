import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { zeroAddress, type Address } from 'viem';
import { WorkspaceAccess } from '../src/components/WorkspaceAccess.js';
import { LedgerContext } from '../src/owner/LedgerContext.js';
import * as clients from '../src/lib/clients.js';
import deployment from '../../../contracts/deployments/177.json';

function View({ address }: { address?: Address }) {
  return (
    <LedgerContext.Provider
      value={{
        address,
        setAddress: vi.fn(),
        accountIndex: 2,
        setAccountIndex: vi.fn(),
      }}
    >
      <WorkspaceAccess chain={177} demo={false}>
        {(publicView) => (
          <p>{publicView ? 'Shared agent data' : 'Personal agent data'}</p>
        )}
      </WorkspaceAccess>
    </LedgerContext.Provider>
  );
}
function ownership() {
  vi.spyOn(clients, 'loadDeployment').mockResolvedValue(
    deployment as clients.Deployment,
  );
  vi.spyOn(clients, 'clientFor').mockReturnValue({
    getChainId: async () => 177,
    readContract: async () => deployment.owner,
  } as never);
}
it('loads no agent view initially and labels an explicitly selected Nishanth workspace', () => {
  render(<View />);
  expect(screen.queryByText('Shared agent data')).toBeNull();
  expect(screen.queryByText('Personal agent data')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'View Nishanth’s mainnet agent' }),
  );
  expect(screen.getByText('Shared agent data')).toBeTruthy();
  expect(
    screen.getByText(/viewing Nishanth’s agent, not your wallet history/),
  ).toBeTruthy();
});
it('clears the shared selection when a different Ledger connects and shows an empty personal workspace', async () => {
  ownership();
  const view = render(<View />);
  fireEvent.click(
    screen.getByRole('button', { name: 'View Nishanth’s mainnet agent' }),
  );
  view.rerender(<View address={zeroAddress} />);
  expect(screen.queryByText('Shared agent data')).toBeNull();
  expect(screen.queryByText('Personal agent data')).toBeNull();
  await screen.findByText(/No Nalvis vault is configured for this Ledger/);
});
it('shows the configured owner workspace after on-chain ownership is checked', async () => {
  ownership();
  render(<View address={deployment.owner as Address} />);
  await waitFor(() =>
    expect(screen.getByText('Personal agent data')).toBeTruthy(),
  );
  expect(screen.getByText('Your Ledger mandate')).toBeTruthy();
  expect(screen.queryByText('Shared agent data')).toBeNull();
});
