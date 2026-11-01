import { expect, test } from 'vitest';
import { operationState } from '../src/components/operations/model.js';
import type { AgentFeed } from '../src/agent/feed-types.js';
const feed: AgentFeed = {
  state: {
    mode: 'live',
    state: 'online',
    provider: 'test',
    models: { strategist: 'test', fitter: 'test' },
    lastWakeAt: 1,
    nextWakeAt: null,
    wakesToday: 1,
    llmCallsToday: 1,
    spendTodayUsd: 0,
    budgetUsd: 1,
    journalHead: null,
    policyHashOk: true,
  },
  watches: [],
  history: [],
  actions: [],
  stats: { calls24h: 0, estimatedSpendUsd: 0, averageLatencyMs: 0 },
};
test('missing feeds do not imply idle, running or completed operations', () => {
  expect(operationState(null, 'execution')).toEqual(
    expect.objectContaining({ label: 'Unavailable', observed: false }),
  );
  expect(operationState(feed, 'receipt').observed).toBe(false);
});
test('synthetic UI examples cannot claim observed execution', () => {
  expect(
    operationState(
      { ...feed, state: { ...feed.state, mode: 'demo' } },
      'checks',
    ),
  ).toEqual(expect.objectContaining({ label: 'UI example', observed: false }));
});
test('transaction references are not described as confirmed fills', () => {
  const action = {
    at: 10,
    intent: { type: 'BUY', notionalB: 1 },
    final: { kind: 'WAIT' },
    trail: 'waiting',
    rounds: [],
    violations: [],
    txHash: '0x123',
  };
  expect(
    operationState({ ...feed, actions: [action] }, 'execution').label,
  ).toBe('Transaction referenced');
  expect(
    operationState({ ...feed, actions: [action] }, 'receipt').observed,
  ).toBe(false);
});
test('latest recorded round is selected by timestamp rather than array order', () => {
  const action = {
    at: 10,
    intent: { type: 'BUY', notionalB: 1 },
    final: { kind: 'WAIT' },
    trail: 'waiting',
    rounds: [
      {
        role: 'strategist',
        round: 1,
        summary: 'Newest observation',
        outputHash: null,
      },
    ],
    violations: [],
  };
  const older = {
    ...action,
    at: 1,
    rounds: [{ ...action.rounds[0], summary: 'Older observation' }],
  };
  expect(
    operationState({ ...feed, actions: [action, older] }, 'strategist').detail,
  ).toBe('Newest observation');
});
