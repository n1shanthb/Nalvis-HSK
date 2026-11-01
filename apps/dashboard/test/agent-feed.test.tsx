import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AgentView } from '../src/views/Agent.js';
import { fixture } from '../src/agent/fixture.js';
import { fallbackMessage, fetchFeed } from '../src/agent/feed-client.js';
import { verificationStore } from '../src/agent/verify-store.js';
vi.mock('../src/views/Evidence.js', () => ({
  EvidenceView: () => <p>Live market chart retained</p>,
  EvidenceDetails: () => null,
}));
vi.mock('../src/views/Portfolio.js', () => ({
  Portfolio: () => <p>Vault chart retained</p>,
}));
vi.mock('../src/agent/useReceiptEvents.js', () => ({
  useReceiptEvents: () => ({ data: [], hasOlder: false }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
const live = {
  ...fixture,
  state: {
    ...fixture.state,
    mode: 'live' as const,
    provider: 'live-provider',
    models: { strategist: 'live/strategist', fitter: 'live/fitter' },
  },
  spendByDay: [{ day: '2026-11-01', usd: 0.2 }],
  stats: { calls24h: 5, estimatedSpendUsd: 0.2, averageLatencyMs: 125 },
};
it('mainnet build rejects a testnet agent feed before reading its actions', async () => {
  vi.stubEnv('VITE_EXECUTION_CHAIN', '177');
  const send = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ ...live.state, executionChainId: 133 }));
  await expect(fetchFeed('https://agent.example')).rejects.toThrow(
    'execution chain mismatch',
  );
  expect(send).toHaveBeenCalledTimes(1);
});
it('production demo stays offline and never fetches the live agent', async () => {
  window.history.replaceState(null, '', '/?demo=1#/agent');
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_AGENT_FEED_URL', 'https://agent.example');
  const send = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('Unexpected network'));
  render(<AgentView />);
  await screen.findByText('Demo: rule engine, not the AI agent');
  expect(
    send.mock.calls.some(([url]) =>
      String(url).startsWith('https://agent.example'),
    ),
  ).toBe(false);
});
it('renders panels and T13A spend chart data from validated live feed', async () => {
  window.history.replaceState(null, '', '/#/agent');
  vi.stubEnv('VITE_AGENT_FEED_URL', 'https://agent.example');
  const send = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const path = String(input);
      if (path.endsWith('/feed/state')) return Response.json(live.state);
      if (path.endsWith('/feed/watches'))
        return Response.json({ active: live.watches, history: live.history });
      if (path.includes('/feed/actions')) return Response.json(live.actions);
      if (path.endsWith('/feed/stats'))
        return Response.json({
          stats: live.stats,
          spendByDay: live.spendByDay,
        });
      throw Error('Unexpected URL');
    });
  render(<AgentView />);
  await screen.findByText('live-provider');
  expect(screen.getByText('live/strategist')).toBeTruthy();
  expect(screen.getByText(/125 ms average latency/)).toBeTruthy();
  expect(screen.queryByText(fallbackMessage)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Agent room' })).toBeTruthy();
  expect(screen.getByLabelText('Agent operations')).toBeTruthy();
  expect(
    send.mock.calls.filter(([url]) =>
      String(url).startsWith('https://agent.example'),
    ),
  ).toHaveLength(4);
});
it('unreachable feed shows the exported snapshot and fallback banner', async () => {
  window.history.replaceState(null, '', '/#/agent');
  vi.stubEnv('VITE_AGENT_FEED_URL', 'https://agent.example');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === '/receipts/133/agent/feed.json')
      return Response.json(live);
    throw Error('Offline');
  });
  render(<AgentView />);
  await screen.findByText(fallbackMessage);
  await screen.findByText('live-provider');
  expect(screen.queryByText('Demo: rule engine, not the AI agent')).toBeNull();
});
it('missing URL and missing export never invent an Agent feed', async () => {
  window.history.replaceState(null, '', '/#/agent');
  vi.stubEnv('VITE_AGENT_FEED_URL', '');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No export'));
  render(<AgentView />);
  await screen.findByText(fallbackMessage);
  await waitFor(() =>
    expect(
      screen.getAllByText('Agent feed not connected yet').length,
    ).toBeGreaterThan(0),
  );
  expect(screen.queryByText(/Agent wanted 200/)).toBeNull();
});
it('browser verifier uses exported journal and exact policy bytes when feed is unavailable', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const p = String(input);
    if (p.endsWith('/journal.json')) return Response.json([]);
    if (p.endsWith('/policy.json')) return new Response('{"version":3}\n');
    throw Error('Unavailable');
  });
  const store = await verificationStore('https://offline.example');
  expect(await store.text('policy.json')).toBe('{"version":3}\n');
  await expect(store.read('../.env')).rejects.toThrow('denied');
  await expect(store.write('x', {})).rejects.toThrow('Read only');
});

it('Verify renders eight independent v3 check chips and keeps earlier passes on a later failure', async () => {
  const { VerifyView } = await import('../src/views/Verify.js');
  const { fireEvent } = await import('@testing-library/react');
  const result = {
    status: 'FAIL' as const,
    label: 'Local v3 verification',
    receiptV3: {} as never,
    checks: [
      { name: 'v3_receipt_hash', pass: true },
      { name: 'v3_policy_binding', pass: true },
      { name: 'v3_journal_range', pass: true },
      { name: 'v3_evidence_hash', pass: true },
      { name: 'v3_system_watch', pass: true },
      { name: 'v3_final_check', pass: true },
      { name: 'v3_final_action', pass: true },
      { name: 'v3_receipt_event', pass: false },
    ],
  };
  render(<VerifyView chain={133} runRecorded={async () => result} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Replay recorded Anvil trade' }),
  );
  const group = await screen.findByLabelText('v3 receipt checks');
  expect(group.querySelectorAll('.badge').length).toBe(8);
  expect(
    [...group.querySelectorAll('.badge')].map((c) => c.textContent),
  ).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'FAIL']);
});
