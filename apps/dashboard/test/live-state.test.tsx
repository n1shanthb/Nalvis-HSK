import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { zeroAddress, TransactionReceiptNotFoundError } from 'viem';
import * as clients from '../src/lib/clients.js';
import { fixture } from '../src/agent/fixture.js';
import { fetchFeed } from '../src/agent/feed-client.js';
import { AgentFeedProvider, useAgentFeed } from '../src/agent/useAgentFeed.js';
import type { ReactNode } from 'react';
import { CostChart } from '../src/components/charts/CostChart.js';
import { LimitChart } from '../src/components/charts/LimitChart.js';
import VaultChart from '../src/components/charts/VaultChart.js';
import { sources } from '../src/lib/chart-data.js';
import { FeedStatus } from '../src/components/FeedStatus.js';
import {
  DecisionHistory,
  TransactionState,
} from '../src/components/DecisionHistory.js';
import { invalidateReads, useResource } from '../src/lib/useResource.js';
import { MandateDetails } from '../src/views/Mandate.js';
import { MainnetOwner } from '../src/owner/MainnetOwner.js';
import { LedgerContext } from '../src/owner/LedgerContext.js';
import { snapshot, owner, vault } from './ux-fixtures.js';
import mainnetDeployment from '../../../contracts/deployments/177.json';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});
const live = {
  ...fixture,
  state: {
    ...fixture.state,
    mode: 'live' as const,
    executionChainId: 177 as const,
  },
};
it('rejects a manifest for a different selected chain even when its addresses are documented', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(mainnetDeployment));
  await expect(clients.loadDeployment(133)).rejects.toThrow(
    'Deployment not verified',
  );
  expect((await clients.loadDeployment(177)).vault.toLowerCase()).toBe(
    mainnetDeployment.vault.toLowerCase(),
  );
});
function feedMock() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/feed/state')) return Response.json(live.state);
    if (url.endsWith('/feed/watches'))
      return Response.json({ active: [], history: [] });
    if (url.includes('/feed/actions')) return Response.json(live.actions);
    if (url.endsWith('/feed/stats'))
      return Response.json({ stats: live.stats });
    throw Error('No snapshot');
  });
}
it('shares one feed observation and polling loop across route consumers', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_AGENT_FEED_URL', 'https://feed.example');
  const fetch = feedMock();
  const hook = renderHook(() => [useAgentFeed(177), useAgentFeed(177)], {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AgentFeedProvider chain={177}>{children}</AgentFeedProvider>
    ),
  });
  await act(async () => {});
  expect(hook.result.current[0]).toBe(hook.result.current[1]);
  expect(hook.result.current[0].feed?.state.executionChainId).toBe(177);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it('labels mainnet limits, model costs and vault charts without testnet defaults', () => {
  render(
    <>
      <CostChart feed={live} />
      <LimitChart source={sources.market} />
      <VaultChart chain={177} />
    </>,
  );
  expect(screen.getAllByText(sources.market)).toHaveLength(3);
  expect(screen.queryByText('Mandate not deployed on 133')).toBeNull();
  expect(screen.queryByText(sources.execution)).toBeNull();
});
it('uses selected chain independently of the build, rejecting unknown and wrong-chain provenance', async () => {
  vi.stubEnv('VITE_EXECUTION_CHAIN', '133');
  const fetch = feedMock();
  expect(
    (await fetchFeed('https://feed.example', undefined, 177)).state
      .executionChainId,
  ).toBe(177);
  fetch.mockResolvedValue(
    Response.json({ ...live.state, executionChainId: 133 }),
  );
  await expect(
    fetchFeed('https://feed.example', undefined, 177),
  ).rejects.toThrow('chain mismatch');
  fetch.mockResolvedValue(
    Response.json({ ...live.state, executionChainId: undefined }),
  );
  await expect(
    fetchFeed('https://feed.example', undefined, 177),
  ).rejects.toThrow('chain mismatch');
});
it('separates missing configuration from an unreachable feed without inserting demo data', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_AGENT_FEED_URL', '');
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('Offline'));
  const missing = renderHook(() => useAgentFeed(177));
  await act(async () => {});
  expect(missing.result.current.connection).toBe('missing');
  expect(missing.result.current.feed).toBeNull();
  expect(fetch).toHaveBeenCalledWith(
    '/receipts/177/agent/feed.json',
    expect.anything(),
  );
  missing.unmount();
  vi.stubEnv('VITE_AGENT_FEED_URL', 'https://feed.example');
  const offline = renderHook(() => useAgentFeed(177));
  await act(async () => {});
  expect(offline.result.current.connection).toBe('unreachable');
  expect(offline.result.current.provenance).toBe('unavailable');
});
it('preserves the last live observation when feed and snapshot refresh fail', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_AGENT_FEED_URL', 'https://feed.example');
  const fetch = feedMock();
  const hook = renderHook(() => useAgentFeed(177));
  await act(async () => {});
  const previous = hook.result.current.feed;
  expect(previous?.state.executionChainId).toBe(177);
  fetch.mockRejectedValue(Error('Offline'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(hook.result.current.feed).toBe(previous);
  expect(hook.result.current.connection).toBe('unreachable');
  expect(hook.result.current.provenance).toBe('live');
});
it('labels exported snapshots and stale agent observations explicitly', () => {
  render(
    <FeedStatus
      observation={{
        feed: live,
        unreachable: true,
        connection: 'missing',
        provenance: 'snapshot',
      }}
    />,
  );
  expect(screen.getByText(/Recorded snapshot — not live/)).toBeTruthy();
  expect(screen.getByText(/Stale last observation/)).toBeTruthy();
});
it('renders chronological WAIT details, IST, original intent and supplied rejection reasons without implying a swap', () => {
  const wait = {
    ...fixture.actions[0],
    at: 1793448000,
    intent: { type: 'HOLD', notionalB: 0 },
    final: { kind: 'WAIT' },
    trail: 'Cost exceeds measured edge',
    txHash: '0x' + 'a'.repeat(64),
    receiptHash: '0x' + 'b'.repeat(64),
  };
  render(
    <DecisionHistory
      actions={[
        wait,
        { ...wait, at: wait.at - 100, final: { kind: 'REJECT' } },
      ]}
      chain={177}
      provenance="snapshot"
    />,
  );
  const summaries = screen.getAllByText(/Decision details ·/);
  expect(summaries[0].textContent).toContain('IST');
  expect(screen.getAllByText(/Cost exceeds measured edge/)).toHaveLength(2);
  expect(
    screen.getAllByText(/Hold decision — a receipt is not a swap/),
  ).toHaveLength(2);
  expect(screen.getAllByText(/Recorded transaction hash/)).toHaveLength(2);
  expect(
    screen
      .getAllByRole('link', { name: 'Transaction ↗' })[0]
      .getAttribute('href'),
  ).toContain('hsk.blockscout.com');
  expect(screen.getAllByText(/Per-trade cap/).length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/Evidence time \/ block: unavailable/),
  ).toHaveLength(2);
});
it('shows Not configured before the first mandate instead of 1970 or Expired', () => {
  render(
    <MandateDetails
      snapshot={{
        ...snapshot,
        mandate: { ...snapshot.mandate, agent: zeroAddress, expiry: 0n },
      }}
    />,
  );
  expect(screen.getAllByText('Not configured')).toHaveLength(2);
  expect(screen.queryByText(/1970/)).toBeNull();
  expect(screen.queryByText('Expired')).toBeNull();
});
it('queues a post-confirmation invalidation behind a slow read and refreshes all mounted reads', async () => {
  let finish!: (value: number) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(2);
  const other = vi.fn().mockResolvedValue('other');
  const first = renderHook(() => useResource(load));
  renderHook(() => useResource(other));
  await act(async () => {
    invalidateReads();
    finish(1);
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(other).toHaveBeenCalledTimes(2);
  expect(first.result.current.data).toBe(2);
});
it('successful refresh and failed refresh preserve mainnet review calldata, acknowledgement and selected account', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_MAINNET_EXECUTION', 'true');
  const load = vi
    .fn()
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce({ ...snapshot, blockNumber: 2n })
    .mockRejectedValue(Error('slow RPC'));
  const { encodeFunctionData } = await import('viem');
  const { vaultAbi } = await import('../../../packages/core/src/abi/index.js');
  const calldata = encodeFunctionData({ abi: vaultAbi, functionName: 'pause' });
  function View() {
    const r = useResource(load);
    return (
      <LedgerContext.Provider
        value={{
          address: owner,
          accountIndex: 3,
          setAddress: vi.fn(),
          setAccountIndex: vi.fn(),
        }}
      >
        <LedgerContext.Consumer>
          {(ledger) => (
            <output data-testid="selected-account">
              {ledger?.accountIndex}
            </output>
          )}
        </LedgerContext.Consumer>
        {r.data && (
          <MainnetOwner
            deployment={{
              vault,
              router: vault,
              owner,
              agent: snapshot.mandate.agent,
              deployer: owner,
              commit: 'a'.repeat(40),
            }}
            snapshot={r.data}
            reload={r.reload}
          />
        )}
        {r.error && <p>Refresh failed</p>}
      </LedgerContext.Provider>
    );
  }
  render(<View />);
  await act(async () => {});
  fireEvent.change(
    screen.getByLabelText('Exact generated mandate or withdrawal calldata'),
    { target: { value: calldata } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review calldata' }));
  const acknowledgement = screen.getByRole('checkbox') as HTMLInputElement;
  fireEvent.click(acknowledgement);
  await act(async () => {
    invalidateReads();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(
    (
      screen.getByLabelText(
        'Exact generated mandate or withdrawal calldata',
      ) as HTMLTextAreaElement
    ).value,
  ).toBe(calldata);
  expect(screen.getByRole('checkbox')).toBe(acknowledgement);
  expect(acknowledgement.checked).toBe(true);
  expect(screen.getByTestId('selected-account').textContent).toBe('3');
  expect(screen.getByText('Refresh failed')).toBeTruthy();
});

it('keeps a submitted pending transaction unconfirmed and invalidates reads only after a successful mined receipt', async () => {
  vi.useFakeTimers();
  const hash = `0x${'a'.repeat(64)}` as const;
  const getTransactionReceipt = vi
    .fn()
    .mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash }))
    .mockResolvedValue({ status: 'success', blockNumber: 12n });
  vi.spyOn(clients, 'clientFor').mockReturnValue({
    getChainId: async () => 177,
    getTransactionReceipt,
    getTransaction: async () => ({ blockNumber: null }),
  } as never);
  const invalidated = vi.fn();
  window.addEventListener('dashboard:reads-invalidated', invalidated);
  try {
    render(<TransactionState hash={hash} chain={177} />);
    await act(async () => {});
    expect(
      screen.getByText(/Submitted · pending — not confirmed/),
    ).toBeTruthy();
    expect(invalidated).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(screen.getByText(/Mined successfully · block 12/)).toBeTruthy();
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Independent receipt verification: not checked/),
    ).toBeTruthy();
  } finally {
    window.removeEventListener('dashboard:reads-invalidated', invalidated);
  }
});

it('reports reverted receipts as failed without treating their hashes as verified or invalidating on success', async () => {
  vi.spyOn(clients, 'clientFor').mockReturnValue({
    getChainId: async () => 177,
    getTransactionReceipt: async () => ({
      status: 'reverted',
      blockNumber: 15n,
    }),
  } as never);
  const invalidated = vi.fn();
  window.addEventListener('dashboard:reads-invalidated', invalidated);
  try {
    render(<TransactionState hash={'0x' + 'a'.repeat(64)} chain={177} />);
    await act(async () => {});
    expect(screen.getByText(/Failed on-chain · block 15/)).toBeTruthy();
    expect(invalidated).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('dashboard:reads-invalidated', invalidated);
  }
});
