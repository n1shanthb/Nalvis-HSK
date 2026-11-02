import type { Evidence } from '../../../../../packages/core/src/types.js';
import type { Mandate } from '../../../../../packages/core/src/policy.js';
import {
  exposure,
  utilisation,
  sources,
  type ChartSource,
} from '../../lib/chart-data.js';
import { ChartFrame } from './ChartFrame.js';
export function LimitChart({
  mandate,
  evidence,
  source = sources.execution,
  at,
  dailySpentB,
  lastTradeB,
  drawdownBps,
  lastTradeAt,
  decimalsB,
}: {
  mandate?: Pick<
    Mandate,
    | 'maxExposureBps'
    | 'maxDailyInB'
    | 'maxTradeInB'
    | 'maxDrawdownBps'
    | 'minIntervalSec'
  >;
  evidence?: Evidence;
  source?: ChartSource;
  at?: number;
  dailySpentB?: number;
  lastTradeB?: number;
  drawdownBps?: number;
  lastTradeAt?: number;
  decimalsB?: number;
}) {
  const v = evidence?.vault;
  const weight =
    v && evidence?.dexMid
      ? exposure(
          v.balanceA,
          v.balanceB,
          v.decimalsA,
          v.decimalsB,
          evidence.dexMid,
        )
      : undefined;
  const decimals = decimalsB ?? v?.decimalsB ?? evidence?.decimalsB;
  const cooldown =
    at !== undefined && lastTradeAt !== undefined && mandate
      ? Math.max(0, mandate.minIntervalSec - (at - lastTradeAt))
      : undefined;
  const rows = mandate
    ? [
        {
          label: 'Exposure (bps)',
          ...utilisation(weight, mandate.maxExposureBps),
        },
        {
          label: 'Daily turnover (USDT)',
          ...utilisation(
            dailySpentB,
            Number(mandate.maxDailyInB) / 10 ** (decimals ?? 0),
          ),
        },
        {
          label: 'Last trade (USDT)',
          ...utilisation(
            lastTradeB,
            Number(mandate.maxTradeInB) / 10 ** (decimals ?? 0),
          ),
        },
        ...(mandate.maxDrawdownBps
          ? [
              {
                label: 'Drawdown (bps)',
                ...utilisation(drawdownBps, mandate.maxDrawdownBps),
              },
            ]
          : []),
        {
          label: 'Cooldown remaining (seconds)',
          ...utilisation(cooldown, mandate.minIntervalSec),
        },
      ]
    : [];
  return (
    <ChartFrame
      title="Mandate limits"
      source={source}
      at={at}
      summary={
        rows.length
          ? rows
              .map(
                (r) =>
                  `${r.label}: ${r.used === undefined ? 'unavailable' : r.used.toFixed(2)} of ${r.cap.toFixed(2)}, ${r.tone}`,
              )
              .join('. ')
          : 'Mandate unavailable on the selected chain'
      }
      headers={['Limit', 'Used', 'Cap', 'Remaining']}
      rows={rows.map((r) => [
        r.label,
        r.used?.toFixed(2) ?? 'Unavailable',
        decimals === undefined && /USDT/.test(r.label)
          ? 'Unavailable'
          : r.cap.toFixed(2),
        r.remaining?.toFixed(2) ?? 'Unavailable',
      ])}
    >
      {!mandate && <p>Mandate unavailable on the selected chain</p>}
      {rows.map((r) => (
        <div className={`limit-row ${r.tone}`} key={r.label}>
          <span>{r.label}</span>
          <span>
            {r.used?.toFixed(2) ?? 'Unavailable'} /{' '}
            {decimals === undefined && /USDT/.test(r.label)
              ? 'Unavailable'
              : r.cap.toFixed(2)}{' '}
            · remaining {r.remaining?.toFixed(2) ?? 'unavailable'}
          </span>
          <div className="limit-track">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, (r.ratio ?? 0) * 100))}%`,
              }}
            />
            <i aria-hidden="true" />
          </div>
        </div>
      ))}
      <p className="muted">
        Amber ≥80% · red ≥100%. Missing observations remain unavailable.
        Cooldown shows time remaining; turnover uses receipt evidence when
        available.
      </p>
    </ChartFrame>
  );
}
