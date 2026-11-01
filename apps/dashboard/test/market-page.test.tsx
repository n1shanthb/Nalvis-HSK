import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { addresses } from '../../../packages/core/src/addresses.js';
import type { ActionView } from '../src/agent/feed-types.js';
const observation = vi.hoisted(() => ({
  actions: [] as ActionView[],
  lastTradeB: undefined as number | undefined,
}));
vi.mock('../src/agent/useAgentFeed.js', () => ({ useAgentFeed: () => ({ feed: null, unreachable: false }) }));
vi.mock('../src/agent/useReceiptEvents.js', () => ({
  useReceiptEvents: () => ({
    data: [
      {
        at: 1,
        args: {
          kind: 0,
          tokenIn: addresses[133].usdt.address,
          amountIn: 25n * 10n ** 18n,
          receiptHash: '0xabc',
        },
        transactionHash: '0xdef',
      },
    ],
  }),
}));
vi.mock('../src/views/Evidence.js', () => ({
  EvidenceView: (props: { actions: ActionView[]; lastTradeB?: number }) => {
    observation.actions = props.actions;
    observation.lastTradeB = props.lastTradeB;
    return <p>Market evidence</p>;
  },
}));
vi.mock('../src/views/Portfolio.js', () => ({ Portfolio: () => null }));
import MarketEvidence from '../src/views/MarketEvidence.js';
test('the separate market page retains transaction-bound markers and testnet notional units', () => {
  render(<MarketEvidence chain={133} />);
  expect(screen.getByText('Market evidence')).toBeTruthy();
  expect(observation.actions[0]).toMatchObject({
    txHash: '0xdef',
    receiptHash: '0xabc',
    final: { kind: 'TRADE' },
  });
  expect(observation.lastTradeB).toBe(25);
});
