import { CostChart } from '../components/charts/CostChart.js';
import { useState } from 'react';
import { Readiness } from '../components/Readiness.js';
import { useAgentFeed } from '../agent/useAgentFeed.js';
import { fallbackMessage } from '../agent/feed-client.js';
import { useReceiptEvents } from '../agent/useReceiptEvents.js';
import {
  displayTime,
  explorerLink,
  type DashboardChain,
} from '../lib/clients.js';
import { DeskView } from './Desk.js';
import type { OwnerProposal } from '../../../../packages/core/src/desk/proposal.js';
import { OperationView } from '../components/operations/OperationView.js';
const at = (time: number | null | undefined) =>
  time ? displayTime(time) : 'Not scheduled';
export function AgentView({
  chain = 133,
  enableOwner = true,
  onProposal,
}: {
  chain?: DashboardChain;
  enableOwner?: boolean;
  onProposal?: (p: OwnerProposal) => void;
}) {
  const { feed, unreachable } = useAgentFeed();
  const receipts = useReceiptEvents(
    chain,
    !feed || unreachable || feed.state.mode === 'live',
  );
  const [history, setHistory] = useState(false);
  const state = feed?.state;
  const mode = !state
    ? 'Agent feed not connected yet'
    : state.mode === 'demo'
      ? 'Demo: rule engine, not the AI agent'
      : {
          online: 'Agent online',
          offline: 'Agent offline — no model key',
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
      {unreachable && <p role="status">{fallbackMessage}</p>}
      <OperationView feed={feed} />
      <div className="agent-workspace">
        <section className="agent-chat">
          <p className="eyebrow">EXPLANATION DESK</p>
          <DeskView
            demo={state?.mode === 'demo'}
            chain={chain}
            onProposal={
              enableOwner && state?.mode !== 'demo' && chain === 133
                ? onProposal
                : undefined
            }
          />
        </section>
        <aside className="agent-events">
          <p className="eyebrow">LATEST DECISIONS</p>
          <p>
            Intent, fitted proposal and final verdict remain separate.{' '}
            <a href="#/activity">Open Activity →</a>
          </p>
          <article className="agent-card">
            <h3>On-chain decisions timeline</h3>
            {receipts.range && !feed && (
              <p>Showing receipts from block {receipts.range}</p>
            )}
            {receipts.hasOlder && (
              <button onClick={() => void receipts.loadOlder()}>
                Load older receipts
              </button>
            )}
            <p>Refreshes every 30 seconds.</p>
            {receipts.error && (
              <p>
                Receipts unavailable. Check the testnet deployment and RPC
                connection.
              </p>
            )}
            {receipts.data?.map((l) => (
              <p key={l.transactionHash + l.logIndex}>
                {displayTime(l.at)} ·{' '}
                {['TRADE', 'RESIZE', 'WAIT', 'REJECT'][l.args.kind ?? 3]} ·{' '}
                <a href={explorerLink(chain, 'tx', l.transactionHash)}>
                  Transaction ↗
                </a>{' '}
                ·{' '}
                <a href={`#/verify?tx=${l.transactionHash}`}>
                  Verify receipt {String(l.args.seq)}
                </a>
              </p>
            ))}
            {!receipts.data?.length && (
              <p>
                {feed
                  ? 'Recorded UI fixtures; no live transaction activity.'
                  : 'Waiting for agent receipts.'}
              </p>
            )}
          </article>
        </aside>
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
                  'Journal head': state.journalHead ?? 'No journal in fixture',
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
      <details className="secondary-section" open={!!feed}>
        <summary>Decision explanations & negotiation</summary>
        <article className="agent-card">
          <h3>Decisions & negotiation trail</h3>
          {!feed && <p>Agent feed not connected yet</p>}
          {feed?.actions.map((a, i) => (
            <div key={i}>
              <h4>
                {a.intent.type} {a.intent.notionalB} USDT → {a.final.kind}
              </h4>
              <p>{at(a.at)}</p>
              <p>{a.trail}</p>
              <ol className="negotiation-stepper">
                {a.rounds.map((r, j) => (
                  <li key={j}>
                    {r.role} · round {r.round}: {r.summary}
                  </li>
                ))}
              </ol>
              {a.violations.map((v) => (
                <span className="badge" key={v.limit}>
                  {v.limit}: {v.required} requested / {v.allowed} allowed
                </span>
              ))}
              {a.txHash && (
                <a href={explorerLink(chain, 'tx', a.txHash)}>Transaction ↗</a>
              )}
              {a.receiptHash && a.txHash && (
                <a href={`#/verify?tx=${a.txHash}`}>Verify receipt</a>
              )}
            </div>
          ))}
        </article>
      </details>
      <details className="secondary-section">
        <summary>Model usage & costs</summary>
        <article className="agent-card">
          <h3>Model stats</h3>
          <CostChart feed={feed} />
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
