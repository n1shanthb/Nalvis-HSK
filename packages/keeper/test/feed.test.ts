import { expect, it } from 'vitest';
import { withSpendByDay } from '../src/feed.js';
it('projects journal costs into seven IST days without mutating the feed or journal', () => {
  const now = Date.parse('2026-10-31T20:00:00Z') / 1000;
  const entries = [
    {
      type: 'LLM_CALL' as const,
      at: Date.parse('2026-10-31T18:29:59Z') / 1000,
      data: { costUsdEst: 0.2 },
    },
    {
      type: 'LLM_CALL' as const,
      at: Date.parse('2026-10-31T18:30:00Z') / 1000,
      data: { costUsdEst: 0.3 },
    },
    { type: 'STATE' as const, at: now, data: { costUsdEst: 99 } },
  ];
  const feed = { state: 'offline' };
  const out = withSpendByDay(feed, entries, now);
  expect(out.spendByDay).toHaveLength(7);
  expect(out.spendByDay.slice(-2)).toEqual([
    { day: '2026-10-31', usd: 0.2 },
    { day: '2026-11-01', usd: 0.3 },
  ]);
  expect(feed).toEqual({ state: 'offline' });
  expect(entries).toHaveLength(3);
});
