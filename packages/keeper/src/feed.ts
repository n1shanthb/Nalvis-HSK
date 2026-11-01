import type { JournalEntry } from '../../core/src/agent/journal.js';
/** Read-only projection of journaled model costs; no provider call or journal writes. */
export function journalSpendByDay(
  entries: Pick<JournalEntry, 'type' | 'at' | 'data'>[],
  now: number,
) {
  const day = (at: number) =>
    new Date((at + 19800) * 1000).toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, i) => ({
    day: day(now - (6 - i) * 86400),
    usd: 0,
  }));
  for (const e of entries) {
    if (e.type !== 'LLM_CALL' || e.at > now) continue;
    const usd = e.data.costUsdEst;
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0)
      throw Error('Invalid journal cost');
    const row = days.find((d) => d.day === day(e.at));
    if (row) row.usd += usd;
  }
  return days;
}
export function withSpendByDay<T extends object>(
  feed: T,
  journal: Pick<JournalEntry, 'type' | 'at' | 'data'>[],
  now: number,
) {
  return { ...feed, spendByDay: journalSpendByDay(journal, now) };
}
