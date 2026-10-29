import type { Evidence } from '@nalvis/core/types.js';
import { useCallback } from 'react';
import {
  collectEvidence,
  endpoints,
} from '@nalvis/core/evidence.js';
import { policySchema } from '@nalvis/core/policy.js';
import policyJSON from '../../../../policy/default.json';
import { clientFor, displayTime } from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
const policy = policySchema.parse(policyJSON);
const sizes = [
  ...new Set(Object.values(policy.presets).flatMap((p) => p.sizeGridB)),
].sort((a, b) => a - b);
const market = clientFor(177),
  execution = clientFor(133);
export const evidenceFetcher: typeof fetch = (input, init) => {
  let url = String(input);
  if (import.meta.env.DEV && import.meta.env.VITE_CEX_PROXY === 'true') {
    if (url === endpoints.mexc)
      url = '/cex/mexc/api/v3/ticker/bookTicker?symbol=HSKUSDT';
    if (url === endpoints.gate)
      url = '/cex/gate/api/v4/spot/tickers?currency_pair=HSK_USDT';
  }
  return fetch(url, init);
};
export function EvidenceDetails({ e }: { e: Evidence }) {
  const mids = e.cex.map((c) => (c.ask + c.bid) / 2);
  const mid = mids.length === 2 ? (mids[0] + mids[1]) / 2 : undefined;
  const now = Math.max(e.now, Math.floor(Date.now() / 1000));
  return (
    <>
      <div className="chart-card">
        <div className="chart-header">
          <h3>Visual DEX-vs-CEX Price Comparison</h3>
          <span className="live-pill">LIVE READ · MAINNET 177</span>
        </div>
        <div className="bar-chart-container">
          <div className="bar-group">
            <span className="bar-label">HSKSwap DEX</span>
            <div className="bar-track">
              {e.dexMid !== undefined ? (
                <div
                  className="bar-fill dex-bar"
                  style={{ width: `${Math.min(100, Math.max(15, e.dexMid * 1.5))}%` }}
                >
                  <span>${e.dexMid.toFixed(4)}</span>
                </div>
              ) : (
                <div className="bar-fill-unavailable">
                  <span>DEX mid unavailable</span>
                </div>
              )}
            </div>
          </div>
          {e.cex.length === 0 ? (
            <div className="bar-group">
              <span className="bar-label">CEX Mid</span>
              <div className="bar-track">
                <div className="bar-fill-unavailable">
                  <span>CEX unavailable</span>
                </div>
              </div>
            </div>
          ) : (
            e.cex.map((c) => {
              const cexVal = (c.bid + c.ask) / 2;
              return (
                <div className="bar-group" key={c.venue}>
                  <span className="bar-label">{c.venue.toUpperCase()} Mid</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill cex-bar"
                      style={{ width: `${Math.min(100, Math.max(15, cexVal * 1.5))}%` }}
                    >
                      <span>${cexVal.toFixed(4)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="metrics">
        <article>
          <span>DEX mid / USDT</span>
          <strong>{e.dexMid?.toFixed(8) ?? 'Unavailable'}</strong>
        </article>
        <article>
          <span>DEX / CEX basis</span>
          <strong>
            {mid && e.dexMid
              ? `${((e.dexMid / mid - 1) * 100).toFixed(3)}%`
              : 'Unavailable'}
          </strong>
        </article>
        <article>
          <span>DEX last swap age</span>
          <strong>
            {e.lastSwapAt !== undefined
              ? `${now - e.lastSwapAt}s${now - e.lastSwapAt > policy.dataQuality.maxDexStaleSec ? ' — stale' : ''}`
              : 'Unavailable'}
          </strong>
        </article>
        <article>
          <span>APRO / off-chain evidence only</span>
          <strong>{e.apro?.price.toFixed(8) ?? 'Unavailable'}</strong>
          <small>
            {e.apro
              ? `${now - e.apro.updatedAt}s old — ${now - e.apro.updatedAt > policy.dataQuality.aproMaxAgeSec ? 'stale' : 'within age limit'}`
              : 'APRO unavailable'}
          </small>
        </article>
      </div>
      <p>
        APRO is never enforced on-chain; the vault oracle is disabled. Evidence
        captured {displayTime(e.now)}, mainnet block {String(e.blockNumber)}.
      </p>
      <div className="metrics">
        {(['mexc', 'gate'] as const).map((venue) => {
          const c = e.cex.find((c) => c.venue === venue);
          return (
            <article key={venue}>
              <span>{venue.toUpperCase()} mid</span>
              <strong>
                {c ? ((c.bid + c.ask) / 2).toFixed(8) : 'CEX unavailable'}
              </strong>
            </article>
          );
        })}
      </div>
      <h3>QuoterV2 one-way cost curve</h3>
      <p>
        Measured against the DEX mid at the same mainnet block. Costs include
        pool fees and price impact.
      </p>
      <table>
        <thead>
          <tr>
            <th>Size / USDT</th>
            <th>Direction</th>
            <th>One-way cost</th>
          </tr>
        </thead>
        <tbody>
          {e.quotes.map((q) => {
            const buy = q.direction === 'BUY_A';
            const fair = e.dexMid
              ? (Number(q.amountIn) / 10 ** (buy ? e.decimalsB : e.decimalsA)) *
                (buy ? 1 / e.dexMid : e.dexMid) *
                10 ** (buy ? e.decimalsA : e.decimalsB)
              : 0;
            return (
              <tr key={`${q.direction}-${q.sizeB}`}>
                <td>{q.sizeB}</td>
                <td>{q.direction}</td>
                <td>
                  {fair > 0
                    ? `${((1 - Number(q.quotedOut) / Number(fair)) * 100).toFixed(4)}%`
                    : 'Unavailable'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!e.quotes.length && <p>Quotes unavailable; no cost estimate.</p>}
      {Object.entries(e.sources)
        .filter(([, s]) => s.error)
        .map(([k, s]) => (
          <p className="muted" key={k}>
            {k}: unavailable — {s.error}
          </p>
        ))}
    </>
  );
}
export function EvidenceView() {
  const resource = useResource(
    useCallback(
      () =>
        collectEvidence({
          marketClient177: market,
          execClient: execution,
          sizes,
          fetcher: evidenceFetcher,
        }),
      [],
    ),
  );
  return (
    <section>
      <p className="eyebrow">02 / SHADOW MODE · MAINNET 177</p>
      <h2>Live market evidence</h2>
      <p>
        Read-only observations. Refreshes 30 seconds after each completed poll.
        No proven edge.
      </p>
      {resource.loading && <p role="status">Collecting evidence…</p>}
      {resource.error && (
        <p role="status">Evidence unavailable — {resource.error}</p>
      )}
      {resource.data && <EvidenceDetails e={resource.data} />}
    </section>
  );
}
