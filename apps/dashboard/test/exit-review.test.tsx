import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExitReview } from '../src/components/ExitReview.js';
import { LedgerContext } from '../src/owner/LedgerContext.js';
import manifest from '../../../contracts/deployments/177.json';
import { zeroHash, type Address } from 'viem';
const signature = '0x' + '1'.repeat(130);
const signMessage = vi.fn(async () => signature);
vi.mock('../src/owner/ledger.js', () => ({
  connectLedger: vi.fn(async () => ({
    address: async () => manifest.owner,
    signMessage,
    disconnect: vi.fn(),
  })),
}));
function mockRequests(executable: boolean) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_url, options) => {
      const now = Math.floor(Date.now() / 1000);
      if (!options?.body)
        return Response.json(
          String(_url).includes('?id=')
            ? { status: 'queued' }
            : {
                owner: manifest.owner,
                vault: manifest.vault,
                chainId: 177,
                policyHash: zeroHash,
                now,
                enabled: true,
              },
        );
      const body = JSON.parse(String(options.body));
      if (body.op === 'confirm')
        return Response.json({ id: zeroHash, status: 'queued' });
      return Response.json({
        executable,
        reason: executable ? '' : 'There is no WHSK position to sell.',
        balanceA: executable ? '10' : '0',
        balanceB: '5',
        block: '12',
        asOf: now,
        pnlReason: 'Verified cost basis unavailable.',
        ...(executable
          ? {
              sellWHSK: '1',
              expectedUSDT: '0.1',
              minimumUSDT: '0.099',
              remainingWHSK: '9',
              partialExit: true,
              order: {
                version: 1,
                delegationHash: zeroHash,
                chainId: 177,
                vault: manifest.vault,
                policyHash: zeroHash,
                tokenIn: manifest.agent,
                notionalB: '0.1',
                amountIn: '1000000000000000000',
                expectedOut: '100000',
                minOut: '99000',
                nonce: '0',
                seq: '0',
                prevHead: zeroHash,
                stateHash: zeroHash,
                createdAt: now,
                validUntil: now + 90,
              },
            }
          : {}),
      });
    });
}
it('shows the empty position and never enables execution for a public viewer', async () => {
  const fetcher = mockRequests(false);
  render(<ExitReview />);
  await screen.findByText('There is no WHSK position to sell.');
  expect(
    (screen.getByRole('button', { name: 'Confirm sell' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(
    screen.getByText('Trade review rejected. No order was submitted.'),
  ).toBeTruthy();
  expect(
    fetcher.mock.calls.some(([, options]) =>
      String(options?.body).includes('"confirm"'),
    ),
  ).toBe(false);
});
it('requires the owner session and a separate explicit Confirm, and binds the displayed order', async () => {
  const fetcher = mockRequests(true);
  render(
    <LedgerContext.Provider
      value={{
        address: manifest.owner as Address,
        accountIndex: 2,
        setAddress: vi.fn(),
        setAccountIndex: vi.fn(),
      }}
    >
      <ExitReview allowTrading />
    </LedgerContext.Provider>,
  );
  await screen.findByText('0.099');
  expect(
    (screen.getByRole('button', { name: 'Confirm sell' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Authorize 15-minute trade session with Ledger',
    }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Confirm sell',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(
    fetcher.mock.calls.filter(([, options]) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      return body?.op === 'preview';
    }),
  ).toHaveLength(2);
  expect(
    fetcher.mock.calls.some(([, options]) =>
      String(options?.body).includes('"confirm"'),
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sell' }));
  await screen.findByText(/Order: queued/);
  const call = fetcher.mock.calls.find(([, options]) =>
    String(options?.body).includes('"confirm"'),
  )!;
  const body = JSON.parse(String(call[1]?.body));
  expect(body.signed.order.minOut).toBe('99000');
  expect(body.signed.order.amountIn).toBe('1000000000000000000');
  expect(signMessage).toHaveBeenCalledTimes(1);
});
it('shows a BUY review with exact USDT input and requires separate owner confirmation', async () => {
  const now = Math.floor(Date.now() / 1000);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    if (!options?.body) return Response.json({ owner: manifest.owner, vault: manifest.vault, chainId: 177, policyHash: zeroHash, now, enabled: true });
    const body = JSON.parse(String(options.body));
    if (body.op === 'confirm') return Response.json({ id: zeroHash, status: 'queued' });
    expect(body.direction).toBe('BUY');
    expect(body.notionalB).toBe('1');
    return Response.json({
      executable: true, direction: 'BUY', balanceA: '0', balanceB: '5', block: '12', asOf: now,
      pnlReason: 'Verified cost basis unavailable.', buyUSDT: '1', expectedWHSK: '11.4', minimumWHSK: '11.3', poolFeeUSDT: '0.003',
      order: { version: 1, delegationHash: zeroHash, chainId: 177, vault: manifest.vault, policyHash: zeroHash,
        tokenIn: manifest.agent, direction: 'BUY', notionalB: '1', amountIn: '1000000', expectedOut: '11400000000000000000', minOut: '11300000000000000000',
        nonce: '0', seq: '0', prevHead: zeroHash, stateHash: zeroHash, createdAt: now, validUntil: now + 90 },
    });
  });
  render(<LedgerContext.Provider value={{ address: manifest.owner as Address, accountIndex: 2, setAddress: vi.fn(), setAccountIndex: vi.fn() }}><ExitReview allowTrading direction="BUY" notionalB="1" /></LedgerContext.Provider>);
  await screen.findByText('11.3');
  expect((screen.getByRole('button', { name: 'Confirm buy' }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher.mock.calls.some(([, options]) => String(options?.body).includes('"confirm"'))).toBe(false);
});
