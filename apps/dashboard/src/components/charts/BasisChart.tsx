import { lazy, Suspense, useMemo } from 'react';
import type { Evidence } from '../../../../../packages/core/src/types.js';
import policy from '../../../../../policy/default.json';
import recorded from '../../../../../data/research/market_history.json';
import { evidenceRows, loadHistory, sources } from '../../lib/chart-data.js';
import { displayTime } from '../../lib/clients.js';
import { ChartFrame } from './ChartFrame.js';
const TimeSeries = lazy(() => import('./TimeSeriesChart.js'));
const history = loadHistory(recorded);
export default function BasisChart({
  points = [],
  demo = false,
  unavailable = false,
}: {
  points?: Evidence[];
  demo?: boolean;
  unavailable?: boolean;
}) {
  const live = useMemo(() => evidenceRows(points), [points]);
  const rows = demo
    ? live
    : [
        ...history.map((r) => ({ time: r.hour, basis: r.basis_pct })),
        ...live.filter((r) => r.time > history.at(-1)!.hour),
      ];
  const values = rows.map((r) => r.basis);
  const lines = [
    policy.presets.balanced.edgeBufferBps,
    policy.dataQuality.maxQuoteVsMidBps,
  ].flatMap((bps, i) =>
    [-1, 1].map((sign) => ({
      value: (sign * bps) / 100,
      title: `${i ? 'Quote deviation' : 'Edge buffer'} ${sign * bps} bps`,
    })),
  );
  return (
    <ChartFrame
      title="Basis history"
      source={
        demo
          ? sources.demo
          : live.length && !unavailable
            ? sources.market
            : sources.recorded
      }
      at={rows.at(-1)?.time}
      summary={`Latest basis ${values.at(-1)?.toFixed(2) ?? 'unavailable'}%. Min ${values.length ? Math.min(...values) : 'unavailable'}%, max ${values.length ? Math.max(...values) : 'unavailable'}%. Thresholds ±${policy.presets.balanced.edgeBufferBps / 100}% and ±${policy.dataQuality.maxQuoteVsMidBps / 100}%.`}
      headers={['Time (IST)', 'Basis %']}
      rows={rows.map((r) => [displayTime(r.time), r.basis])}
    >
      {!demo && (
        <p>
          <span className="badge">{sources.recorded}</span> · Recorded mainnet
          177 history · measured 27/10/2026 IST
        </p>
      )}
      {unavailable && !demo && <p role="status">Live data unavailable</p>}
      <p className="muted">
        DEX / CEX − 1 · balanced policy reference thresholds · observations
        only, gaps stay gaps.
      </p>
      <Suspense fallback={<p>Loading basis chart…</p>}>
        <TimeSeries
          series={[
            {
              name: 'Basis %',
              color: '#75baff',
              points: rows.map((r) => ({ time: r.time, value: r.basis })),
            },
          ]}
          lines={lines}
          liveFrom={!demo ? live[0]?.time : undefined}
        />
      </Suspense>
    </ChartFrame>
  );
}
