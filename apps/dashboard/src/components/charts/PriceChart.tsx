import { lazy, Suspense, useMemo, useState } from 'react';
import type { Evidence } from '../../../../../packages/core/src/types.js';
import policy from '../../../../../policy/default.json';
import recorded from '../../../../../data/research/market_history.json';
import type { ActionView } from '../../agent/feed-types.js';
import {
  decisionMarkers,
  evidenceRows,
  exposure,
  insideEngineBand,
  loadHistory,
  sources,
} from '../../lib/chart-data.js';
import { displayTime } from '../../lib/clients.js';
import { ChartFrame } from './ChartFrame.js';
const TimeSeries = lazy(() => import('./TimeSeriesChart.js'));
const history = loadHistory(recorded);
export default function PriceChart({
  points,
  demo = false,
  unavailable = false,
  actions = [],
}: {
  points: Evidence[];
  demo?: boolean;
  unavailable?: boolean;
  actions?: ActionView[];
}) {
  const [presetName, setPreset] =
    useState<keyof typeof policy.presets>('balanced');
  const preset = policy.presets[presetName];
  const live = useMemo(() => evidenceRows(points), [points]);
  const seed = history.filter(
    (r) => r.hour >= history.at(-1)!.hour - 47 * 3600,
  );
  const rows = demo
    ? live
    : [
        ...seed.map((r) => ({
          time: r.hour,
          dex: r.dex,
          cex: r.cex,
          basis: r.basis_pct,
        })),
        ...live.filter((r) => r.time > history.at(-1)!.hour),
      ];
  const latest = rows.at(-1),
    evidence = points.at(-1),
    vault = evidence?.vault;
  const weight =
    vault && evidence?.dexMid
      ? exposure(
          vault.balanceA,
          vault.balanceB,
          vault.decimalsA,
          vault.decimalsB,
          evidence.dexMid,
        )
      : undefined;
  const state =
    weight === undefined
      ? 'Engine band state unavailable'
      : insideEngineBand(weight / 10000, preset.targetWeightA, preset.bandBps)
        ? 'Inside band'
        : 'Outside band';
  const markers = decisionMarkers(actions);
  const lines = latest
    ? [
        {
          value: latest.cex * (1 - preset.bandBps / 10000),
          title: 'Lower price reference',
        },
        {
          value: latest.cex * (1 + preset.bandBps / 10000),
          title: 'Upper price reference',
        },
        ...(evidence?.apro
          ? [{ value: evidence.apro.price, title: 'APRO reference' }]
          : []),
      ]
    : [];
  const prices = rows.flatMap((r) => [r.dex, r.cex]);
  return (
    <ChartFrame
      title="Live price vs mandate band"
      source={
        demo
          ? sources.demo
          : live.length && !unavailable
            ? sources.market
            : sources.recorded
      }
      at={latest?.time}
      summary={`DEX ${latest?.dex ?? 'unavailable'}, CEX ${latest?.cex ?? 'unavailable'} USDT. Min ${prices.length ? Math.min(...prices) : 'unavailable'}, max ${prices.length ? Math.max(...prices) : 'unavailable'}. ${state}. Basis ${latest?.basis.toFixed(2)}%.`}
      headers={['Time (IST)', 'DEX / USDT', 'CEX / USDT', 'Basis %']}
      rows={rows.map((r) => [displayTime(r.time), r.dex, r.cex, r.basis])}
    >
      {!demo && (
        <p>
          <span className="badge">{sources.recorded}</span> · recorded mainnet
          history (measured 27/10/2026 IST)
        </p>
      )}
      {unavailable && !demo && <p role="status">Live data unavailable</p>}
      <label>
        Policy reference preset{' '}
        <select
          value={presetName}
          onChange={(e) =>
            setPreset(e.target.value as keyof typeof policy.presets)
          }
        >
          {Object.keys(policy.presets).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <p>
        {state} · basis {latest?.basis.toFixed(2) ?? '—'}%
      </p>
      <p className="muted">
        Active keeper preset unavailable. Engine band uses portfolio weight;
        dashed price references show ±{preset.bandBps} bps around CEX mid.
      </p>
      <Suspense fallback={<p>Loading price chart…</p>}>
        <TimeSeries
          series={['dex', 'cex'].map((k, i) => ({
            name: k.toUpperCase(),
            color: i ? '#75baff' : '#47a878',
            points: rows.map((r) => ({
              time: r.time,
              value: r[k as 'dex' | 'cex'],
            })),
          }))}
          lines={lines}
          markers={markers}
          liveFrom={!demo ? live[0]?.time : undefined}
        />
      </Suspense>
      {!demo && live[0] && (
        <p>│ Live from here · {displayTime(live[0].time)}</p>
      )}
      <ul aria-label="Decision markers and receipts">
        {markers.map((m, i) => (
          <li key={i}>
            {displayTime(m.time)} · {m.text} ·{' '}
            {m.href ? (
              <a href={m.href}>Inspect receipt</a>
            ) : (
              'No receipt available'
            )}
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
