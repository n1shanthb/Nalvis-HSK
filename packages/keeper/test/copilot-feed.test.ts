import { it, expect } from 'vitest';
import { zeroHash } from 'viem';
import { memoryStore, createJournal } from '../../core/src/agent/index.js';
import { projectFeed, type AgentState } from '../src/agent-feed.js';

it('does not attribute preceding autonomous model rounds or violations to an owner-confirmed sell', async () => {
  const store = memoryStore(),
    journal = await createJournal(store);
  await journal.append('WAKE', {}, 1);
  await journal.append(
    'LLM_CALL',
    {
      role: 'strategist',
      round: 1,
      parsedOk: true,
      outputHash: zeroHash,
      costUsdEst: 0,
    },
    1,
  );
  await journal.append(
    'MANDATE_CHECK',
    { violations: [{ limit: 'previous autonomous check' }] },
    1,
  );
  await journal.append(
    'ACTION',
    { kind: 'WAIT', reason: 'Autonomous wait' },
    1,
  );
  await store.write(`receipts/${zeroHash}.json`, {
    version: 4,
    receiptHash: zeroHash,
    intent: { type: 'SELL', notionalB: '0.1' },
    final: { direction: 'SELL' },
    fit: {
      trail: 'Owner-confirmed Copilot sell; not an autonomous model decision',
    },
  });
  await journal.append(
    'ACTION',
    { kind: 'TRADE', receiptHash: zeroHash, amountIn: '1', minOut: '1' },
    2,
  );
  const state: AgentState = {
    mode: 'live',
    state: 'online',
    provider: 'openrouter',
    models: { strategist: 'test', fitter: 'test' },
    lastWakeAt: 1,
    nextWakeAt: null,
    wakesToday: 1,
    llmCallsToday: 1,
    spendTodayUsd: 0,
    budgetUsd: 1,
    journalHead: journal.head,
    policyHashOk: true,
  };
  const feed = await projectFeed(store, state, journal.entries, 2);
  expect(feed.actions[0].trail).toContain('Owner-confirmed');
  expect(feed.actions[0].rounds).toEqual([]);
  expect(feed.actions[0].violations).toEqual([]);
  expect(feed.actions[1].rounds).toHaveLength(1);
  expect(feed.actions[1].violations).toHaveLength(1);
});
