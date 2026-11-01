import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeFunctionData } from 'viem';
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
import { createMarketHandler } from '../server/market.js';
import { owner, vault, snapshot } from './ux-fixtures.js';
test('header exposes workspace pages and advanced verification', () => {
  render(<Header demo={false} onDesk={() => {}} />);
  for (const name of ['Overview', 'Mandate', 'Activity', 'Agent'])
    expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(
      `#/${name.toLowerCase()}`,
    );
  expect(
    screen
      .getAllByRole('link', { name: 'Set mandate' })[0]
      .getAttribute('href'),
  ).toBe('#/setup');
  fireEvent.click(screen.getByText('Advanced'));
  expect(
    screen.getByRole('link', { name: 'Verify receipt' }).getAttribute('href'),
  ).toBe('#/verify');
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
    'Slippage (bps)',
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
test.each(['usdt', 'whsk'] as const)(
  '%s withdraw calldata matches ABI',
  (token) => {
    const withdrawal = {
      token: addresses[133][token].address,
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
  },
);
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
    expect(fetcher).toHaveBeenCalledTimes(1);
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

test('WHSK slider preserves 0.5 and UI preset calldata matches the existing form builder', () => {
  vi.useFakeTimers();
  try {
    render(
      <MandateWizard
        chain={133}
        vault={vault}
        snapshot={snapshot}
        previewOnly
      />,
    );
    fireEvent.click(screen.getByText('Choose a preset'));
    fireEvent.click(screen.getByRole('button', { name: /Balanced/ }));
    fireEvent.change(screen.getByRole('slider', { name: 'WHSK per trade' }), {
      target: { value: '0.5' },
    });
    fireEvent.click(screen.getByText('Compare current and proposed'));
    fireEvent.click(screen.getByText('Build Ledger review'));
    const data = screen
      .getByText('Exact mandate calldata')
      .parentElement!.querySelector('code')!.textContent;
    const fields = {
      ...fieldsFor(snapshot),
      maxTradeInA: '0.5',
      maxTradeInB: '100',
      maxDailyInB: '500',
      maxExposureBps: '8000',
      maxSlippageBps: '50',
      maxDrawdownBps: '2000',
      minIntervalSec: '300',
      expiry: String(Math.floor(Date.now() / 1000) + 7 * 86400),
    };
    expect(data).toBe(
      encodeFunctionData({
        abi: vaultAbi,
        functionName: 'setMandate',
        args: [validateMandate(fields, snapshot)],
      }),
    );
    expect(validateMandate(fields, snapshot).maxTradeInA).toBe(5n * 10n ** 17n);
  } finally {
    vi.useRealTimers();
  }
});

test('owner actions respect paused/revoked state and require explicit revoke confirmation', () => {
  const view = render(
    <OwnerActions chain={133} vault={vault} snapshot={snapshot} />,
  );
  expect((screen.getByText('Unpause') as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByText('Revoke'));
  expect(
    (screen.getByText('Sign reviewed action on Ledger') as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByLabelText('Revoke removes agent authority immediately'),
  );
  expect(
    (screen.getByText('Sign reviewed action on Ledger') as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  view.rerender(
    <OwnerActions
      chain={133}
      vault={vault}
      snapshot={{
        ...snapshot,
        paused: true,
        mandate: {
          ...snapshot.mandate,
          agent: '0x0000000000000000000000000000000000000000',
        },
      }}
    />,
  );
  expect((screen.getByText('Pause') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Revoke') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Agent revoked')).toBeTruthy();
});
