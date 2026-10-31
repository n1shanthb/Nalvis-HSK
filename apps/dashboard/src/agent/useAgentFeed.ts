import type { AgentFeed } from './feed-types.js';
// Synthetic UI examples only. No fabricated transaction or receipt hashes.
const fixture: AgentFeed = {
  state: {
    mode: 'demo',
    state: 'online',
    provider: 'Recorded rule engine',
    models: { strategist: 'No AI model', fitter: 'Deterministic fixture' },
    lastWakeAt: 1793448000,
    nextWakeAt: 1793448300,
    wakesToday: 12,
    llmCallsToday: 0,
    spendTodayUsd: 0,
    budgetUsd: 1,
    journalHead: null,
    policyHashOk: true,
  },
  watches: [
    {
      id: 'basis-rise',
      label: 'Wake if DEX price rises 2% from 0.0875',
      kind: 'price',
      createdBy: 'system',
      note: 'Recheck the basis before considering a rebalance.',
      createdAt: 1793447700,
      expiresAt: 1793534100,
      fireCount: 0,
    },
  ],
  history: [
    {
      at: 1793447700,
      op: 'create',
      by: 'system',
      watchId: 'basis-rise',
      label: 'DEX +2%',
      reason: 'Wait for an observable price change.',
      accepted: true,
    },
  ],
  actions: [
    {
      at: 1793448000,
      intent: { type: 'BUY', notionalB: 200 },
      final: {
        kind: 'RESIZE',
        direction: 'BUY_A',
        amountIn: '50',
        minOut: 'Quote required before execution',
      },
      trail:
        'Agent wanted 200 USDT BUY · mandate cap 100 · fitter: 2×50 across cooldown · leg 1 simulated · leg 2 pending (fixture only)',
      rounds: [
        {
          role: 'strategist',
          round: 1,
          summary: 'Proposed 200 USDT BUY',
          outputHash: null,
        },
        {
          role: 'fitter',
          round: 1,
          summary: 'Reduced to 50 USDT legs with cooldown',
          outputHash: null,
        },
      ],
      violations: [
        { limit: 'Per-trade cap (USDT)', required: '200', allowed: '100' },
      ],
    },
  ],
  stats: { calls24h: 0, estimatedSpendUsd: 0, averageLatencyMs: 0 },
};
export function useAgentFeed(): AgentFeed | null {
  return new URLSearchParams(window.location.search).get('demo') === '1'
    ? fixture
    : null;
}
