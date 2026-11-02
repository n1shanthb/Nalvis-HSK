import type { AgentFeed } from '../../agent/feed-types.js';
import { sources, istDay, type ChartSource } from '../../lib/chart-data.js';
import { ChartFrame } from './ChartFrame.js';
export function CostChart({
  feed,
  source,
}: {
  feed: AgentFeed | null;
  source?: ChartSource;
}) {
  const s = feed?.state;
  const at = s?.lastWakeAt ?? undefined;
  const rows =
    feed?.spendByDay ??
    (s ? [{ day: at ? istDay(at) : 'Today (IST)', usd: s.spendTodayUsd }] : []);
  const budget = s?.budgetUsd;
  const max = Math.max(budget ?? 0, ...rows.map((r) => r.usd), 0.01);
  const y = (v: number) => 135 - (v / max) * 110;
  return (
    <ChartFrame
      title="Model cost per day"
      source={
        source ??
        (s?.mode === 'demo'
          ? sources.demo
          : s?.executionChainId === 177
            ? sources.market
            : sources.execution)
      }
      at={at}
      summary={
        s
          ? `${rows.length} IST days. Latest spend $${s.spendTodayUsd}; daily budget $${budget}; ${s.llmCallsToday} calls today. ${s.state}`
          : 'Live data unavailable: model cost feed not connected'
      }
      headers={['Day (IST)', 'USD']}
      rows={rows.map((r) => [r.day, r.usd])}
    >
      {!s ? (
        <p>Live data unavailable · model cost feed not connected</p>
      ) : (
        <>
          {s.state === 'budget_paused' && (
            <p className="danger" role="status">
              budget_paused
            </p>
          )}
          <svg viewBox="0 0 560 175" aria-hidden="true">
            {rows.map((r, i) => (
              <g key={r.day}>
                <rect
                  x={45 + i * 70}
                  y={y(r.usd)}
                  width="32"
                  height={135 - y(r.usd)}
                  fill="#a3e635"
                />
                <text x={45 + i * 70} y="154" fontSize="10" fill="currentColor">
                  {r.day.slice(5)}
                </text>
                <text
                  x={45 + i * 70}
                  y={y(r.usd) - 5}
                  fontSize="10"
                  fill="currentColor"
                >
                  ${r.usd.toFixed(3)}
                </text>
              </g>
            ))}
            <line
              data-testid="budget-reference"
              data-budget={budget}
              x1="25"
              x2="540"
              y1={y(budget!)}
              y2={y(budget!)}
              stroke="currentColor"
              strokeDasharray="5 4"
            />
          </svg>
          <p>
            Daily budget ${budget} · Today: ${s.spendTodayUsd} ·{' '}
            {s.llmCallsToday} LLM calls
          </p>
          {!feed?.spendByDay && (
            <p className="muted">
              Today only · daily journal series unavailable.
            </p>
          )}
        </>
      )}
    </ChartFrame>
  );
}
