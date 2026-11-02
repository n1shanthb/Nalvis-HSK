import { useCallback } from 'react';
import { z } from 'zod';
import type { FeedObservation } from '../agent/useAgentFeed.js';
import { agentFeedBase, readFeedJSON } from '../agent/feed-client.js';
import { displayTime } from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
import { readStrategyNotes } from '../agent/strategy-notes.js';

const policySummary = z.object({
  executionChainId: z.number(),
  strategyHash: z.string(),
  strategy: z.object({
    marketContext: z.string().optional(),
    fitRounds: z.number(),
  }),
});
const outcomes = ['TRADE', 'RESIZE', 'WAIT', 'REJECT'];
/** Summarizes recorded outputs; the feed does not expose an in-flight model phase. */
export function AgentPulse({
  observation,
  compact = false,
}: {
  observation: FeedObservation;
  compact?: boolean;
}) {
  const { feed, provenance, connection } = observation;
  const actions = [...(feed?.actions ?? [])].sort((a, b) => a.at - b.at);
  const latest = actions.at(-1);
  const strategistHash = latest?.rounds
    .filter(
      (round) =>
        round.role === 'strategist' &&
        round.round === 0 &&
        round.summary === 'Validated response recorded',
    )
    .at(-1)?.outputHash;
  const strategyNotes = useResource(
    useCallback(async () => {
      if (provenance !== 'live' || !strategistHash) return null;
      return readStrategyNotes(strategistHash);
    }, [provenance, strategistHash]),
  );
  const policy = useResource(
    useCallback(async () => {
      if (provenance !== 'live' || !feed) return null;
      const raw = await readFeedJSON(agentFeedBase(), '/feed/policy');
      const envelope = z.object({ text: z.string() }).parse(raw);
      const parsed = policySummary.parse(JSON.parse(envelope.text));
      if (parsed.executionChainId !== feed.state.executionChainId)
        throw Error('Policy chain mismatch');
      return parsed;
    }, [provenance, feed?.state.executionChainId]),
  );
  if (!feed)
    return (
      <section className="agent-pulse agent-card" aria-label="Agent pulse">
        <p className="eyebrow">AGENT PULSE</p>
        <h2>Connecting to the agent</h2>
        <p>
          Live decisions will appear here when the read-only feed is available.
          No activity is assumed.
        </p>
      </section>
    );
  const connected = provenance === 'live' && connection === 'connected';
  const samples = actions.slice(-50);
  return (
    <section className="agent-pulse agent-card" aria-label="Agent pulse">
      <div className="pulse-heading">
        <div>
          <p className="eyebrow">
            AGENT PULSE / CHAIN {feed.state.executionChainId ?? 'DEMO'}
          </p>
          <h2>
            {connected ? 'Agent connected' : 'Recorded agent observation'}
          </h2>
        </div>
        <span className="badge">
          {connected ? '' : 'LAST OBSERVED: '}
          {feed.state.state.replaceAll('_', ' ').toUpperCase()}
        </span>
      </div>
      <div className="pulse-metrics">
        <div>
          <span>Latest decision</span>
          <strong>{latest?.final.kind ?? 'Not observed'}</strong>
        </div>
        <div>
          <span>Wakes today</span>
          <strong>{feed.state.wakesToday}</strong>
        </div>
        <div>
          <span>Model calls today</span>
          <strong>{feed.state.llmCallsToday}</strong>
        </div>
        <div>
          <span>Spend / daily budget</span>
          <strong>
            ${feed.state.spendTodayUsd.toFixed(4)} / $
            {feed.state.budgetUsd.toFixed(2)}
          </strong>
        </div>
      </div>
      <article className="pulse-rationale">
        <p className="micro-label">
          LATEST RECORDED RATIONALE{' '}
          {latest ? `· ${displayTime(latest.at)}` : ''}
        </p>
        <p>
          {latest?.trail ||
            'No explanation supplied in the current observation.'}
        </p>
        <small>
          Recorded output from the last decision. In-progress model thinking is
          not exposed by the feed.
        </small>
      </article>
      <div className="pulse-grid">
        <div>
          <h3>Strategy & execution</h3>
          {strategyNotes.data && (
            <article className="recorded-thesis">
              <p className="micro-label">LATEST RECORDED STRATEGY THESIS</p>
              <p>{strategyNotes.data.thesis}</p>
              <p>
                Model-reported confidence:{' '}
                {Math.round(strategyNotes.data.confidence * 100)}% (not a win
                probability).
              </p>
              <ul>
                {strategyNotes.data.signals.map((signal, i) => (
                  <li key={i}>{signal}</li>
                ))}
              </ul>
            </article>
          )}
          {strategyNotes.error && (
            <small>
              The detailed strategy output could not be loaded. The recorded
              decision rationale remains above.
            </small>
          )}
          <p>
            The strategist chooses direction, timing and size within the signed
            mandate. The fitter negotiates compliant proposals; deterministic
            checks govern execution.
          </p>
          {policy.data && (
            <p>
              Market context:{' '}
              {policy.data.strategy.marketContext === 'fresh-dex-cex'
                ? 'Executable HSKSwap quotes + fresh MEXC / Gate context. Stale APRO excluded from decisions.'
                : 'See the signed policy for source rules.'}{' '}
              Up to {policy.data.strategy.fitRounds} fitting rounds.
            </p>
          )}
          {policy.error && (
            <small>
              Strategy policy read unavailable; no policy details assumed.
            </small>
          )}
          <p className="pulse-model">
            Strategist: {feed.state.models.strategist}
            <br />
            Fitter: {feed.state.models.fitter}
          </p>
          <p>
            Last wake:{' '}
            {feed.state.lastWakeAt == null
              ? 'Not observed'
              : displayTime(feed.state.lastWakeAt)}
            <br />
            Next wake:{' '}
            {feed.state.nextWakeAt == null
              ? 'Not scheduled'
              : displayTime(feed.state.nextWakeAt)}
          </p>
        </div>
        <div>
          <h3>Decision activity</h3>
          <p className="micro-label">
            {samples.length} RECORDED DECISIONS · OLDEST → NEWEST
          </p>
          {samples.length ? (
            <>
              <svg
                viewBox="0 0 600 140"
                role="img"
                aria-label="Recorded decision outcomes over time"
                className="pulse-chart"
              >
                {outcomes.map((kind, row) => (
                  <g key={kind}>
                    <text
                      x="0"
                      y={22 + row * 32}
                      fill="currentColor"
                      fontSize="12"
                    >
                      {kind}
                    </text>
                    <line
                      x1="72"
                      x2="590"
                      y1={18 + row * 32}
                      y2={18 + row * 32}
                      stroke="currentColor"
                      opacity="0.15"
                    />
                  </g>
                ))}
                {samples.map((action, i) => (
                  <circle
                    key={`${action.at}-${i}`}
                    cx={82 + i * (498 / Math.max(1, samples.length - 1))}
                    cy={
                      18 + Math.max(0, outcomes.indexOf(action.final.kind)) * 32
                    }
                    r="5"
                    fill="currentColor"
                  >
                    <title>
                      {displayTime(action.at)} · {action.final.kind}
                    </title>
                  </circle>
                ))}
              </svg>
              <p className="pulse-legend">
                {outcomes.map((kind) => (
                  <span key={kind}>
                    {kind}:{' '}
                    {
                      actions.filter((action) => action.final.kind === kind)
                        .length
                    }
                  </span>
                ))}
              </p>
              <small>
                Each dot is a recorded decision, not a swap confirmation. Even
                spacing preserves decision order.
              </small>
            </>
          ) : (
            <p>No decisions in the current observation.</p>
          )}
        </div>
      </div>
      {!compact && (
        <div className="pulse-watches">
          <h3>What can wake the agent?</h3>
          {feed.watches.length ? (
            <ul>
              {feed.watches.map((watch) => (
                <li key={watch.id}>
                  <strong>{watch.label}</strong>
                  <span>{watch.note}</span>
                  <small>
                    {watch.createdBy} · fired {watch.fireCount} times
                    {watch.expiresAt
                      ? ` · expires ${displayTime(watch.expiresAt)}`
                      : ''}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No active watches supplied in the feed.</p>
          )}
        </div>
      )}
      <a href={compact ? '#/agent' : '#/activity'}>
        {compact ? 'Open agent room' : 'Inspect full decision history'} →
      </a>
    </section>
  );
}
