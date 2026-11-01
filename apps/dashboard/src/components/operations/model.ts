import type { AgentFeed } from '../../agent/feed-types.js';
export const stages = [
  {
    id: 'evidence',
    label: 'Evidence',
    type: 'DATA',
    detail:
      'Block-pinned market observations. Live freshness must be checked on Market evidence.',
    position: [-4.8, 1.15, 0.4],
  },
  {
    id: 'strategist',
    label: 'Strategist',
    type: 'AI',
    detail:
      'Proposes an intent and manages watches. Cannot sign or bypass limits.',
    position: [0, 1.45, -4.2],
  },
  {
    id: 'fitter',
    label: 'Fitter',
    type: 'AI',
    detail:
      'Fits a proposal to the mandate. The final deterministic checks remain authoritative.',
    position: [0, 1.15, 4.6],
  },
  {
    id: 'checks',
    label: 'Checks',
    type: 'CODE',
    detail: 'Validates authority, policy and execution constraints.',
    position: [-3, 1.05, -2],
  },
  {
    id: 'execution',
    label: 'Execution',
    type: 'CODE',
    detail: 'Bounded testnet execution. Submission is not confirmation.',
    position: [3, 1.05, -2],
  },
  {
    id: 'receipt',
    label: 'Receipt',
    type: 'PROOF',
    detail:
      'Evidence commitment and transaction binding. Verify independently in Activity.',
    position: [4.8, 1.15, 0.4],
  },
] as const;
export function operationState(feed: AgentFeed | null, id: string) {
  if (!feed)
    return {
      label: 'Unavailable',
      detail: 'No connected agent feed. No stage activity is assumed.',
      observed: false,
    };
  if (feed.state.mode === 'demo')
    return {
      label: 'UI example',
      detail:
        'Illustrative role layout. Recorded transaction receipts are separately available in Activity.',
      observed: false,
    };
  const action = [...feed.actions].sort((a, b) => b.at - a.at)[0];
  const round = action?.rounds
    .filter((r) => r.role.toLowerCase() === id)
    .at(-1);
  if (round)
    return { label: 'Observed round', detail: round.summary, observed: true };
  if (id === 'checks' && action)
    return {
      label: 'Verdict available',
      detail: `Final verdict: ${action.final.kind}. ${action.trail}`,
      observed: true,
    };
  if (id === 'execution' && action?.txHash)
    return {
      label: 'Transaction referenced',
      detail: `Transaction ${action.txHash}. Confirmation must be checked independently.`,
      observed: true,
    };
  if (id === 'receipt' && action?.receiptHash)
    return {
      label: 'Commitment referenced',
      detail: action.receiptHash,
      observed: true,
    };
  return {
    label: 'Not observed',
    detail:
      "The available feed does not establish this stage's current activity.",
    observed: false,
  };
}
