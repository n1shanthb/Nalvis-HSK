import { readChartRisk, sources } from '../lib/chart-data.js';
import { LimitChart } from '../components/charts/LimitChart.js';
import { VaultValue } from '../components/VaultValue.js';
import { CoinGeckoReference } from '../components/CoinGeckoReference.js';
import { lazy, Suspense } from 'react';
const BasisChart = lazy(() => import('../components/charts/BasisChart.js'));
import type { ActionView } from '../agent/feed-types.js';
const PriceChart = lazy(() => import('../components/charts/PriceChart.js'));
import type { Evidence } from '../../../../packages/core/src/types.js';
import { useCallback, useEffect, useState } from 'react';
import {
  collectEvidence,
  endpoints,
} from '../../../../packages/core/src/evidence.js';
import { policySchema } from '../../../../packages/core/src/policy.js';
import policyJSON from '../../../../policy/default.json';
import {
  clientFor,
  displayTime,
  loadDeployment,
  type DashboardChain,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
const policy = policySchema.parse(policyJSON);
const sizes = [
  ...new Set(Object.values(policy.presets).flatMap((p) => p.sizeGridB)),
].sort((a, b) => a - b);
const market = clientFor(177);
export const evidenceFetcher: typeof fetch = (input, init) => {
  let url = String(input);
  if (import.meta.env.DEV && import.meta.env.VITE_CEX_PROXY === 'true') {
    if (url === endpoints.mexc)
      url = '/cex/mexc/api/v3/ticker/bookTicker?symbol=HSKUSDT';
    if (url === endpoints.gate)
      url = '/cex/gate/api/v4/spot/tickers?currency_pair=HSK_USDT';
  }
  if (
    import.meta.env.PROD &&
    (url === endpoints.mexc || url === endpoints.gate)
  ) {
    const venue = url === endpoints.mexc ? 'mexc' : 'gate';
    return fetch(`/api/market?venue=${venue}`, init).then(async (response) => {
      if (!response.ok) return response;
      const body = await response.json();
      return Response.json(body[venue]);
    });
  }
  return fetch(url, init);
};
export function EvidenceDetails({
  e,
  compact = false,
}: {
  e: Evidence;
  compact?: boolean;
}) {
  const mids = e.cex.map((c) => (c.ask + c.bid) / 2);
  const mid = mids.length === 2 ? (mids[0] + mids[1]) / 2 : undefined;
  const now = Math.max(e.now, Math.floor(Date.now() / 1000));
  return (
    <>
      <div className="metrics">
        <article>
          <span>DEX mid / USDT</span>
          <strong>{e.dexMid?.toFixed(8) ?? 'Unavailable'}</strong>
        </article>
        <article>
          <span>CEX mid / USDT</span>
          <strong>{mid?.toFixed(8) ?? 'Unavailable'}</strong>
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
      {!compact && (
        <>
          <p>
            APRO is never enforced on-chain; the vault oracle is disabled.
            Evidence captured {displayTime(e.now)}, mainnet block{' '}
            {String(e.blockNumber)}.
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
            Measured against the DEX mid at the same mainnet block. Costs
            include pool fees and price impact.
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
                  ? (Number(q.amountIn) /
                      10 ** (buy ? e.decimalsB : e.decimalsA)) *
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
            .map(([k]) => (
              <p className="muted" key={k}>
                {k}: unavailable — check source connectivity and freshness.
              </p>
            ))}
        </>
      )}
    </>
  );
}
export function EvidenceView({
  chain = 133,
  compact = false,
  actions = [],
  lastTradeB,
}: {
  chain?: DashboardChain;
  compact?: boolean;
  actions?: ActionView[];
  lastTradeB?: number;
} = {}) {
  const resource = useResource(
    useCallback(async () => {
      const execution = clientFor(chain);
      const deployment = await loadDeployment(chain).catch(() => undefined);
      const evidence = await collectEvidence({
        vault: deployment?.vault,
        marketClient177: market,
        execClient: execution,
        sizes: chain === 177 ? [0.1, 0.5, 1] : sizes,
        decisionTtlSec: policy.decisionTtlSec ?? 120,
        fetcher: evidenceFetcher,
      });
      const chartRisk =
        evidence.vault && deployment
          ? await readChartRisk(
              execution,
              deployment.vault,
              evidence.executionBlockNumber,
              evidence.vault.decimalsB,
            ).catch(() => undefined)
          : undefined;
      return { ...evidence, chartRisk };
    }, [chain]),
  );
  const [history, setHistory] = useState<Evidence[]>([]);
  useEffect(() => {
    if (resource.data)
      setHistory((h) =>
        [
          ...h.filter((e) => e.now !== resource.data!.now),
          resource.data!,
        ].slice(-120),
      );
  }, [resource.data]);
  return (
    <section>
      <p className="eyebrow">02 / SHADOW MODE · MAINNET 177</p>
      <h1>Live market evidence</h1>
      <p>
        Read-only observations. Refreshes 30 seconds after each completed poll.
        No proven edge.
      </p>
      {resource.loading && (
        <p className="skeleton" role="status">
          Collecting evidence…
        </p>
      )}
      {resource.error && (
        <p role="status">
          Evidence unavailable. Please check the network connection and retry.
        </p>
      )}
      <LimitChart
        source={
          chain === 177
            ? sources.market
            : chain === 31337
              ? sources.demo
              : sources.execution
        }
        mandate={resource.data?.vault?.mandate}
        evidence={resource.data}
        at={resource.data?.chartRisk?.at ?? resource.data?.now}
        dailySpentB={resource.data?.chartRisk?.dailySpentB}
        lastTradeAt={resource.data?.chartRisk?.lastTradeAt}
        lastTradeB={lastTradeB}
        drawdownBps={
          resource.data?.vault &&
          resource.data.dexMid &&
          resource.data.chartRisk?.highWaterB
            ? Math.max(
                0,
                (1 -
                  ((Number(resource.data.vault.balanceA) /
                    10 ** resource.data.vault.decimalsA) *
                    resource.data.dexMid +
                    Number(resource.data.vault.balanceB) /
                      10 ** resource.data.vault.decimalsB) /
                    resource.data.chartRisk.highWaterB) *
                  10000,
              )
            : undefined
        }
      />
      <VaultValue chain={chain} price={resource.data?.dexMid} />
      <Suspense fallback={<p>Loading market chart…</p>}>
        <PriceChart
          points={history}
          actions={actions}
          unavailable={
            !!resource.error || (!resource.loading && !resource.data)
          }
        />
      </Suspense>
      <Suspense fallback={<p>Loading basis history…</p>}>
        <BasisChart points={history} unavailable={!!resource.error} />
      </Suspense>
      <CoinGeckoReference />

      {resource.data && <EvidenceDetails e={resource.data} compact={compact} />}
    </section>
  );
}
