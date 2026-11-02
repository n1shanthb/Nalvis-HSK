import '../src/owner/MandateForm.js';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { keccak256, zeroAddress, zeroHash } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { addresses } from '../../../packages/core/src/addresses.js';
import {
  proposalCalldata,
  mandateBaseline,
  type OwnerProposal,
} from '../../../packages/core/src/desk/proposal.js';
import * as clients from '../src/lib/clients.js';
import { App } from '../src/App.js';
vi.mock('../src/lib/clients.js', async (importOriginal) => ({
  ...(await importOriginal<typeof clients>()),
  loadDeployment: vi.fn(),
  readVault: vi.fn(),
}));
vi.mock('../src/views/Desk.js', () => ({
  DeskView: ({ onProposal }: { onProposal?: (p: OwnerProposal) => void }) => (
    <button onClick={() => onProposal?.(proposal)}>
      Load desk cap proposal
    </button>
  ),
}));
const owner = mnemonicToAccount(
  'test test test test test test test test test test test junk',
).address;
const agent = mnemonicToAccount(
  'test test test test test test test test test test test junk',
  { addressIndex: 1 },
).address;
const vault = addresses[133].primaryPool.address;
const mandate = {
  agent,
  expiry: 1900000000n,
  maxTradeInA: 10n ** 18n,
  maxTradeInB: 100n * 10n ** 18n,
  maxDailyInB: 500n * 10n ** 18n,
  maxExposureBps: 8000,
  maxSlippageBps: 50,
  maxDrawdownBps: 1000,
  minIntervalSec: 30n,
  policyHash: zeroHash,
};
const diff = { maxTradeInB: String(25n * 10n ** 18n) };
const proposal: OwnerProposal = {
  action: 'setMandate',
  diff,
  calldataHash: keccak256(proposalCalldata('setMandate', diff, mandate)),
  baselineHash: mandateBaseline(mandate, false),
  target: { vault, chainId: 133 },
};
beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'true');
  window.history.replaceState({}, '', '/?demo=0#/mandate');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Offline'));
  vi.mocked(clients.loadDeployment).mockResolvedValue({
    vault,
    router: vault,
    block: 1n,
    owner,
    agent,
    deployer: addresses[133].whsk.address,
    commit: 'a'.repeat(40),
  });
  vi.mocked(clients.readVault).mockResolvedValue({
    owner,
    pendingOwner: zeroAddress,
    mandate,
    paused: false,
    decimalsA: 18,
    decimalsB: 18,
    blockNumber: 1n,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});
it('explicit live landing route overrides a demo build and keeps the owner panel reachable', async () => {
  render(<App enableOwner />);
  await screen.findByRole('button', { name: 'Revoke' }, { timeout: 15000 });
  expect(
    screen.getAllByRole('button', { name: 'Connect Ledger' }).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByText('Recorded demo 31337')).toBeNull();
});
it.each(['cancel', 'navigation'])(
  'clears a desk proposal on %s',
  async (mode) => {
    render(<App enableOwner />);
    await screen.findByRole('button', { name: 'Revoke' }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('link', { name: 'Nalvis Copilot' }));
    fireEvent.click(await screen.findByText('Load desk cap proposal'));
    await screen.findByText('Build exact desk proposal review');
    expect(screen.queryByText('Build revoke review')).toBeNull();
    if (mode === 'cancel') {
      fireEvent.click(screen.getByText('Build exact desk proposal review'));
      fireEvent.click(screen.getByText('Cancel review'));
    } else {
      window.location.hash = '#/home';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await screen.findByRole('link', { name: /Live console/ });
      window.location.hash = '#/mandate';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    await waitFor(() =>
      expect(screen.queryByText('Build exact desk proposal review')).toBeNull(),
    );
    expect(
      await screen.findByRole('button', { name: 'Revoke' }, { timeout: 15000 }),
    ).toBeTruthy();
  },
);
