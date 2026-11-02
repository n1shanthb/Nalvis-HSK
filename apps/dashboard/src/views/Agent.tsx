import { CostChart } from '../components/charts/CostChart.js';
import { sources } from '../lib/chart-data.js';
import { useState } from 'react';
import { Readiness } from '../components/Readiness.js';
import { useAgentFeed } from '../agent/useAgentFeed.js';
import { fallbackMessage } from '../agent/feed-client.js';
import { FeedStatus } from '../components/FeedStatus.js';
import { CurrentMandate } from '../components/CurrentMandate.js';
import { AgentPulse } from '../components/AgentPulse.js';
import {
  displayTime,
  type DashboardChain,
} from '../lib/clients.js';
import type { OwnerProposal } from '../../../../packages/core/src/desk/proposal.js';
const at = (time: number | null | undefined) =>
  time ? displayTime(time) : 'Not scheduled';
export function AgentView({
  chain = 133,
}: {
  chain?: DashboardChain;
  enableOwner?: boolean;
  onProposal?: (p: OwnerProposal) => void;
}) {
  const observation = useAgentFeed(chain);
  const { feed, unreachable } = observation;
  const [history, setHistory] = useState(false);
  const state = feed?.state;
  const mode = !state
    ? 'Agent feed not connected yet'
    : state.mode === 'demo'
      ? 'Demo: rule engine, not the AI agent'
      : {
          online: 'Agent online',
          offline: 'Agent offline — reason unavailable in feed',
          budget_paused: 'Budget paused',
          needs_owner: 'Needs owner',
        }[state.state];
  return (
    <section className="agent-view">
      <p className="eyebrow">AGENT</p>
      <h1>Agent room</h1>
      <p className="page-description">
        Strategist and Fitter propose. Deterministic checks bound execution.
        Every outcome leaves evidence.
      </p>
      <Readiness feed={feed} demo={state?.mode === 'demo'} chain={chain} />
      <FeedStatus observation={observation} />
      <AgentPulse observation={observation} />
      {state?.mode !== 'demo' && <CurrentMandate chain={chain} />}
      <p><a href="#/activity">View decisions and receipts →</a></p>
      {unreachable && <p role="status">{fallbackMessage}</p>}
      <p><a href="#/operations">Open 3D operations view →</a></p>
      <div className="agent-workspace">
        <p><a href="#/desk">Open Nalvis Copilot →</a></p>
      </div>
      <details className="secondary-section">
        <summary>Agent status & scheduling</summary>
        <article className="agent-card agent-status-line">
          <div className="readiness-heading">
            <span className="eyebrow">EXECUTION READINESS</span>
            <a href="#/mandate">Review mandate ↗</a>
          </div>
          <h3>Agent status</h3>
          <strong className="readiness-status">{mode}</strong>
          {!state && (
            <p>
              Live agent status and decisions are unavailable. Review the
              mandate and deployment, or{' '}
              <a href="?demo=1#/agent">explore the recorded demo</a>.{' '}
              <a href="#/evidence">Market observations</a> remain read-only.
            </p>
          )}
          {state && (
            <details className="agent-diagnostics">
              <summary>Agent diagnostics & scheduling</summary>
              <dl>
                {Object.entries({
                  Provider: state.provider,
                  Strategist: state.models.strategist,
                  Fitter: state.models.fitter,
                  'Last wake': at(state.lastWakeAt),
                  'Next scheduled wake': at(state.nextWakeAt),
                  'Wakes today': state.wakesToday,
                  'LLM calls today': state.llmCallsToday,
                  'Spend / budget (USD)': `${state.spendTodayUsd} / ${state.budgetUsd}`,
                  'Policy hash': state.policyHashOk ? 'Matches' : 'Needs owner',
                  'Journal head': state.journalHead ?? 'Unavailable',
                }).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </article>
      </details>
      <details className="secondary-section" open={!!feed}>
        <summary>Watches & activity</summary>
        <article className="agent-card">
          <div
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const next = !history;
                setHistory(next);
                const tabs =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                tabs[next ? 1 : 0]?.focus();
              }
            }}
            role="tablist"
            aria-label="Agent watches"
          >
            <button
              role="tab"
              tabIndex={history ? -1 : 0}
              id="active-watches-tab"
              aria-controls="active-watches-panel"
              aria-selected={!history}
              onClick={() => setHistory(false)}
            >
              Active watches
            </button>
            <button
              role="tab"
              tabIndex={history ? 0 : -1}
              id="watch-history-tab"
              aria-controls="watch-history-panel"
              aria-selected={history}
              onClick={() => setHistory(true)}
            >
              Watch history
            </button>
          </div>
          <div
            role="tabpanel"
            hidden
            id={history ? 'active-watches-panel' : 'watch-history-panel'}
            aria-labelledby={
              history ? 'active-watches-tab' : 'watch-history-tab'
            }
          />
          <div
            role="tabpanel"
            tabIndex={0}
            id={history ? 'watch-history-panel' : 'active-watches-panel'}
            aria-labelledby={
              history ? 'watch-history-tab' : 'active-watches-tab'
            }
          >
            {!feed ? (
              <p>Agent feed not connected yet</p>
            ) : history ? (
              [...feed.history]
                .sort((a, b) => b.at - a.at)
                .map((w, i) => (
                  <div key={i}>
                    <h4>
                      {w.op}: {w.label}
                    </h4>
                    <p>
                      {w.reason} · {w.by} · {at(w.at)} ·{' '}
                      {w.accepted ? 'Accepted' : w.rejectReason}
                    </p>
                  </div>
                ))
            ) : (
              feed.watches.map((w) => (
                <div key={w.id}>
                  <h4>{w.label}</h4>
                  <p>
                    Set by {w.createdBy} · {w.note}
                  </p>
                  <p>
                    Created {at(w.createdAt)} · Last fired{' '}
                    {w.lastFiredAt ? at(w.lastFiredAt) : 'Never'} ·{' '}
                    {w.fireCount} fires · Expires {at(w.expiresAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>
      </details>
      <details className="secondary-section">
        <summary>Model usage & costs</summary>
        <article className="agent-card">
          <h3>Model stats</h3>
          <CostChart
            feed={feed}
            source={
              observation.provenance === 'demo'
                ? sources.demo
                : observation.provenance === 'snapshot'
                  ? sources.agentSnapshot
                  : !feed
                    ? sources.agentUnavailable
                    : observation.connection !== 'connected'
                      ? sources.agentObservation
                      : chain === 177
                        ? sources.market
                        : chain === 31337
                          ? sources.demo
                          : sources.execution
            }
          />
          {feed ? (
            <p>
              {feed.stats.calls24h} calls / 24h · $
              {feed.stats.estimatedSpendUsd} estimated spend ·{' '}
              {feed.stats.averageLatencyMs} ms average latency
            </p>
          ) : (
            <p>Agent feed not connected yet</p>
          )}
        </article>
      </details>
    </section>
  );
}
