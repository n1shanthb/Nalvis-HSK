import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  decodeFunctionData,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { vaultAbi } from '../../../packages/core/src/abi/index.js';
import manifest from '../../../contracts/deployments/177.json';
import { MainnetOwner } from '../src/owner/MainnetOwner.js';
import { expiryInput, expirySeconds } from '../src/owner/MainnetMandateForm.js';
import { LedgerContext } from '../src/owner/LedgerContext.js';
import type { VaultSnapshot, Deployment } from '../src/lib/clients.js';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), send: vi.fn() }));
vi.mock('../src/owner/ledger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/owner/ledger.js')>()),
  connectLedger: mocks.connect,
  sendOwnerAction: mocks.send,
}));
vi.mock('../src/components/DecisionHistory.js', () => ({
  TransactionState: () => <p>Checking mined receipt</p>,
}));
const policyHash = `0x${'12'.repeat(32)}` as Hex;
const snapshot: VaultSnapshot = {
  owner: manifest.owner as Address,
  pendingOwner: zeroAddress,
  paused: false,
  blockNumber: 1n,
  decimalsA: 18,
  decimalsB: 6,
  mandate: {
    agent: manifest.agent as Address,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 86400),
    maxTradeInA: 11386704556773835410n,
    maxTradeInB: 1000000n,
    maxDailyInB: 5000000n,
    maxExposureBps: 10000,
    maxSlippageBps: 100,
    maxDrawdownBps: 2000,
    minIntervalSec: 60n,
    policyHash,
  },
};
const deployment = { ...manifest, block: BigInt(manifest.block) } as Deployment;
function view(next = snapshot) {
  return (
    <LedgerContext.Provider
      value={{
        address: manifest.owner as Address,
        accountIndex: 2,
        setAddress: vi.fn(),
        setAccountIndex: vi.fn(),
      }}
    >
      <MainnetOwner snapshot={next} deployment={deployment} reload={vi.fn()} />
    </LedgerContext.Provider>
  );
}
beforeEach(() => {
  vi.stubEnv('VITE_MAINNET_EXECUTION', 'true');
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({});
  mocks.send.mockResolvedValue(`0x${'a'.repeat(64)}`);
});
afterEach(() => vi.unstubAllEnvs());

it('generates exact mainnet units from readable fields, preserves policy, and signs only after explicit review on account 3', async () => {
  render(view());
  expect(
    (screen.getByLabelText('USDT per trade') as HTMLInputElement).value,
  ).toBe('1');
  expect(
    (screen.getByLabelText('Maximum WHSK exposure (%)') as HTMLInputElement)
      .value,
  ).toBe('100');
  fireEvent.change(screen.getByLabelText('USDT per trade'), {
    target: { value: '1.25' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review mandate' }));
  expect(
    screen.getByRole('table', { name: 'Current vs Proposed' }),
  ).toBeTruthy();
  const sign = screen.getByRole('button', {
    name: 'Sign reviewed action on Ledger',
  });
  expect((sign as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.connect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(sign);
  await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
  expect(mocks.connect).toHaveBeenCalledWith(177, 2);
  const decoded = decodeFunctionData({
    abi: vaultAbi,
    data: mocks.send.mock.calls[0][0].data,
  });
  if (decoded.functionName !== 'setMandate') throw Error('Wrong action');
  expect(decoded.args[0]).toEqual({
    ...snapshot.mandate,
    maxTradeInB: 1250000n,
  });
  expect(screen.getByText('Checking mined receipt')).toBeTruthy();
});

it.each([
  ['Maximum slippage (%)', '1.01', 'Slippage must be between'],
  ['USDT per trade', '0.0000001', 'at most 6 decimal places'],
  ['Maximum WHSK exposure (%)', '100.01', 'between 0 and 100'],
  ['Minimum interval (seconds)', '1.5', 'nonnegative uint256'],
  ['Expiry (IST)', '2020-01-01T00:00:00', 'Expiry must be in the future'],
])('rejects invalid %s before any Ledger connection', (label, value, error) => {
  render(view());
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review mandate' }));
  expect(screen.getByRole('alert').textContent).toContain(error);
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('invalidates review after field edits or a changed on-chain mandate, but not a new read block', () => {
  const { rerender } = render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Review mandate' }));
  fireEvent.click(screen.getByRole('checkbox'));
  rerender(view({ ...snapshot, blockNumber: 2n }));
  expect(
    (
      screen.getByRole('button', {
        name: 'Sign reviewed action on Ledger',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  rerender(
    view({
      ...snapshot,
      mandate: { ...snapshot.mandate, maxDailyInB: 6000000n },
    }),
  );
  expect(screen.getByRole('alert').textContent).toContain('on-chain mandate');
  expect(
    (
      screen.getByRole('button', {
        name: 'Sign reviewed action on Ledger',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('USDT per trade'), {
    target: { value: '2' },
  });
  expect(
    screen.queryByRole('button', { name: 'Sign reviewed action on Ledger' }),
  ).toBeNull();
});

it('does not substitute a testnet policy when the mainnet commitment is missing', () => {
  render(
    view({
      ...snapshot,
      mandate: { ...snapshot.mandate, policyHash: zeroHash },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review mandate' }));
  expect(screen.getByRole('alert').textContent).toContain(
    'reviewed keeper policy',
  );
  expect(mocks.send).not.toHaveBeenCalled();
});

it('converts the explicitly labelled IST expiry exactly, including seconds', () => {
  expect(expiryInput('1793681963')).toBe('2026-11-03T10:29:23');
  expect(expirySeconds('2026-11-03T10:29:23')).toBe('1793681963');
  expect(expiryInput('')).toBe('');
  expect(expiryInput('1'.repeat(80))).toBe('');
});
