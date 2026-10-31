import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeFunctionData, zeroHash } from 'viem';
import { Header } from '../src/components/Header.js';
import { ConnectLedger } from '../src/owner/ConnectLedger.js';
import {
  MandateWizard,
  MandateDiff,
  wizardCalldata,
} from '../src/owner/MandateWizard.js';
import { fieldsFor, validateMandate } from '../src/owner/MandateForm.js';
import {
  OwnerActions,
  ownerActionCalldata,
} from '../src/owner/OwnerActions.js';
import { AgentView } from '../src/views/Agent.js';
import { evidenceFetcher } from '../src/views/Evidence.js';
import { endpoints } from '../../../packages/core/src/evidence.js';
import { vaultAbi } from '../../../packages/core/src/abi/index.js';
import { addresses } from '../../../packages/core/src/addresses.js';
import type { VaultSnapshot } from '../src/lib/clients.js';
import { createMarketHandler } from '../server/market.js';
const owner = addresses[133].whsk.address,
  vault = addresses[133].primaryPool.address;
const snapshot: VaultSnapshot = {
  owner,
  paused: false,
  blockNumber: 1n,
  decimalsA: 18,
  decimalsB: 18,
  mandate: {
    agent: addresses[133].usdt.address,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 86400),
    maxTradeInA: 10n ** 18n,
    maxTradeInB: 25n * 10n ** 18n,
    maxDailyInB: 100n * 10n ** 18n,
    maxExposureBps: 8000,
    maxSlippageBps: 50,
    maxDrawdownBps: 2000,
    minIntervalSec: 300n,
    policyHash: zeroHash,
  },
};
test('header has the three navigation items and Ledger affordance', () => {
  render(<Header demo={false} onDesk={() => {}} />);
  for (const name of ['Mandate', 'Agent', 'Verify'])
    expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(
      `#/${name.toLowerCase()}`,
    );
  expect(screen.getByRole('button', { name: 'Connect Ledger' })).toBeTruthy();
});
test.each([true, false])('Ledger ownership is checked (%s)', async (same) => {
  const disconnect = vi.fn(async () => {});
  const signerFactory = vi.fn(async () => ({
    address: async () => owner,
    disconnect,
    signTransaction: vi.fn(),
  }));
  render(
    <ConnectLedger
      vault={vault}
      signerFactory={signerFactory}
      readOwner={async () => (same ? owner : vault)}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Connect Ledger' }));
  expect(
    await screen.findByText(same ? 'Owner ✓' : 'Not the vault owner'),
  ).toBeTruthy();
  expect(disconnect).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Disconnect'));
  expect(screen.queryByText('Owner ✓')).toBeNull();
});
test('wizard calldata matches existing builder exactly', () => {
  const fields = fieldsFor(snapshot);
  expect(wizardCalldata(fields, snapshot)).toBe(
    encodeFunctionData({
      abi: vaultAbi,
      functionName: 'setMandate',
      args: [validateMandate(fields, snapshot)],
    }),
  );
});
test('wizard sliders enforce slippage cap and provide review', () => {
  render(
    <MandateWizard chain={133} vault={vault} snapshot={snapshot} previewOnly />,
  );
  fireEvent.click(screen.getByText('Choose a preset'));
  fireEvent.click(screen.getByRole('button', { name: /Balanced/ }));
  const slider = screen.getByRole('slider', {
    name: 'Slippage cap (bps)',
  }) as HTMLInputElement;
  expect(slider.max).toBe('100');
  fireEvent.change(slider, { target: { value: '999' } });
  expect(Number(slider.value)).toBeLessThanOrEqual(100);
  fireEvent.click(screen.getByText('Compare current and proposed'));
  expect(screen.getByText('Current vs Proposed')).toBeTruthy();
  fireEvent.click(screen.getByText('Build Ledger review'));
  expect(screen.getByText('Exact mandate calldata')).toBeTruthy();
});
test('diff highlights only changed fields', () => {
  const current = fieldsFor(snapshot);
  const view = render(
    <MandateDiff
      current={current}
      proposed={{ ...current, maxSlippageBps: '75' }}
    />,
  );
  expect(view.container.querySelectorAll('[data-changed="true"]')).toHaveLength(
    1,
  );
  expect(view.container.querySelector('.changed')?.textContent).toContain(
    'maxSlippageBps',
  );
});
test.each(['pause', 'unpause', 'revoke'] as const)(
  '%s calldata matches ABI',
  (action) => {
    expect(ownerActionCalldata(133, action)).toBe(
      encodeFunctionData({ abi: vaultAbi, functionName: action }),
    );
  },
);
test('withdraw calldata matches ABI', () => {
  const withdrawal = {
    token: addresses[133].usdt.address,
    amount: 10n ** 18n,
    to: owner,
  };
  expect(ownerActionCalldata(133, 'withdraw', withdrawal)).toBe(
    encodeFunctionData({
      abi: vaultAbi,
      functionName: 'withdraw',
      args: [withdrawal.token, withdrawal.amount, owner],
    }),
  );
});
test.each([177, 31337])(
  'owner actions refuse chain %s before signing',
  (chain) => {
    expect(() => ownerActionCalldata(chain, 'pause')).toThrow();
    render(<OwnerActions chain={chain} vault={vault} snapshot={snapshot} />);
    expect(screen.getByRole('alert').textContent).toContain('refuse');
    expect(screen.queryByText('Pause')).toBeNull();
  },
);
describe('market proxy', () => {
  test('caches tickers for five seconds and handles failures', async () => {
    let time = 0;
    const fetcher = vi.fn(async (url: unknown) =>
      Response.json(
        String(url) === endpoints.mexc
          ? { bidPrice: '1', askPrice: '2' }
          : [{ highest_bid: '1', lowest_ask: '2' }],
      ),
    );
    const handler = createMarketHandler(fetcher, () => time);
    const request = () =>
      new Request('https://example.test/api/market?venue=mexc');
    expect((await handler(request())).status).toBe(200);
    expect(await (await handler(request())).json()).toHaveProperty('gate');
    expect(fetcher).toHaveBeenCalledTimes(2);
    time = 5001;
    fetcher.mockRejectedValue(Error('offline'));
    expect((await handler(request())).status).toBe(502);
  });
  test('production evidence reads same-origin proxy', async () => {
    vi.stubEnv('PROD', true);
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ mexc: { bidPrice: '1', askPrice: '2' }, gate: [] }),
      );
    try {
      const result = await evidenceFetcher(endpoints.mexc);
      expect(fetcher).toHaveBeenCalledWith('/api/market?venue=mexc', undefined);
      expect(await result.json()).toEqual({ bidPrice: '1', askPrice: '2' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
test('Agent uses demo fixtures only under explicit query flag', async () => {
  window.history.replaceState(null, '', '?demo=1#/agent');
  const view = render(<AgentView />);
  expect(screen.getByText('Demo: rule engine, not the AI agent')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Active watches' })).toBeTruthy();
  expect(screen.getByText(/Agent wanted 200 USDT BUY/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Watch history' }));
  expect(screen.getByText(/Wait for an observable price change/)).toBeTruthy();
  view.unmount();
  window.history.replaceState(null, '', '/#/agent');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Offline test'));
  render(<AgentView />);
  await waitFor(() =>
    expect(
      screen.getAllByText('Agent feed not connected yet').length,
    ).toBeGreaterThan(0),
  );
  expect(screen.queryByText(/Agent wanted 200 USDT BUY/)).toBeNull();
});
