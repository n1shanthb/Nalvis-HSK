import type { Evidence } from '../../../../packages/core/src/types.js';
import { displayTime } from '../lib/clients.js';
export function MarketChart({ points }: { points: Evidence[] }) {
  const rows = points
    .filter((e) => e.dexMid && e.cex.length === 2)
    .map((e) => ({
      time: e.now,
      dex: e.dexMid!,
      cex: e.cex.reduce((n, c) => n + (c.bid + c.ask) / 2, 0) / 2,
    }));
  if (!rows.length)
    return (
      <p role="status">
        Chart unavailable: waiting for DEX and both CEX observations.
      </p>
    );
  const prices = rows.flatMap((r) => [r.dex, r.cex]),
    lo = Math.min(...prices) * 0.998,
    hi = Math.max(...prices) * 1.002;
  const first = rows[0].time,
    last = rows.at(-1)!.time;
  const x = (t: number) =>
    45 + (last === first ? 0.5 : (t - first) / (last - first)) * 700;
  const y = (p: number) => 180 - ((p - lo) / (hi - lo)) * 145;
  return (
    <article className="chart">
      <div className="chart-heading">
        <h3>Price & spread history</h3>
        <span>
          ● DEX <span className="cex-legend">● CEX mid</span>
        </span>
      </div>
      <svg
        viewBox="0 0 800 270"
        role="img"
        aria-label="DEX and CEX prices over time, with basis below"
      >
        <line x1="45" y1="180" x2="745" y2="180" stroke="#405147" />
        {(['dex', 'cex'] as const).map((key, i) => (
          <g key={key}>
            <polyline
              fill="none"
              stroke={i ? '#75baff' : '#c4ef94'}
              strokeWidth="2.5"
              points={rows.map((r) => `${x(r.time)},${y(r[key])}`).join(' ')}
            />
            {rows.map((r, j) => (
              <circle
                key={j}
                cx={x(r.time)}
                cy={y(r[key])}
                r="3"
                fill={i ? '#75baff' : '#c4ef94'}
              >
                <title>
                  {displayTime(r.time)} · {key}: {r[key].toFixed(8)}
                </title>
              </circle>
            ))}
          </g>
        ))}
        <text x="45" y="20" fill="#9bad9f" fontSize="12">
          USDT {hi.toFixed(5)} / {lo.toFixed(5)}
        </text>
        {rows.map((r, i) => (
          <text
            key={i}
            x={x(r.time)}
            y="225"
            textAnchor="middle"
            fill="#b7c6b9"
            fontSize="11"
          >
            {((r.dex / r.cex - 1) * 100).toFixed(2)}%
          </text>
        ))}
        <text x="45" y="265" fill="#9bad9f" fontSize="11">
          {displayTime(first)}
        </text>
        <text x="745" y="265" textAnchor="end" fill="#9bad9f" fontSize="11">
          {displayTime(last)}
        </text>
      </svg>
      <p className="muted">Basis = DEX / CEX − 1. Observation points only.</p>
    </article>
  );
}
