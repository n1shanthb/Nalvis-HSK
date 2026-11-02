import { lazy, Suspense } from 'react';
import type { Verification } from '../../../../../packages/verifier/src/verify.js';
import { vaultSeries, sources } from '../../lib/chart-data.js';
import { displayTime } from '../../lib/clients.js';
import type { DashboardChain } from '../../lib/clients.js';
import { ChartFrame } from './ChartFrame.js';
const TimeSeries = lazy(() => import('./TimeSeriesChart.js'));
export default function VaultChart({
  results = [],
  demo = false,
  chain = 133,
}: {
  results?: Verification[];
  demo?: boolean;
  chain?: DashboardChain;
}) {
  let rows: ReturnType<typeof vaultSeries> = [];
  try {
    rows = vaultSeries(results);
  } catch {
    /* Fail closed on an unverified or noncontiguous receipt prefix. */
  }
  const values = rows.flatMap((r) => [r.vault, r.hold]);
  return (
    <ChartFrame
      title="Vault value vs hold · after gas · no proven edge"
      source={
        demo || chain === 31337
          ? sources.demo
          : chain === 177
            ? sources.market
            : sources.execution
      }
      at={rows.at(-1)?.time}
      summary={`Vault value after gas ${rows.at(-1)?.vault.toFixed(2) ?? 'unavailable'} USDT; hold ${rows.at(-1)?.hold.toFixed(2) ?? 'unavailable'} USDT. Min ${values.length ? Math.min(...values) : 'unavailable'}, max ${values.length ? Math.max(...values) : 'unavailable'}. No proven edge.`}
      headers={['Time (IST)', 'Vault after gas / USDT', 'Hold / USDT']}
      rows={rows.map((r) => [displayTime(r.time), r.vault, r.hold])}
    >
      {!rows.length ? (
        <p>Live data unavailable · contiguous verified receipts required.</p>
      ) : (
        <Suspense fallback={<p>Loading verified vault history…</p>}>
          <TimeSeries
            series={(['vault', 'hold'] as const).map((k, i) => ({
              name: k,
              area: k === 'vault',
              color: i ? '#a3e635' : '#5eead4',
              points: rows.map((r) => ({ time: r.time, value: r[k] })),
            }))}
          />
        </Suspense>
      )}
      <p className="muted">
        No proven edge · after gas. No deposits or withdrawals assumed between
        receipts; token B assumed USD-pegged. Testnet and local Anvil prices are
        not real.
      </p>
    </ChartFrame>
  );
}
