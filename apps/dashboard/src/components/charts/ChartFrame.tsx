import type { ReactNode } from 'react';
import { displayTime } from '../../lib/clients.js';
import type { ChartSource } from '../../lib/chart-data.js';
export function ChartFrame({
  title,
  source,
  at,
  summary,
  children,
  rows,
  headers = ['Time (IST)', 'Value'],
}: {
  title: string;
  source: ChartSource;
  at?: number;
  summary: string;
  children: ReactNode;
  rows: (string | number)[][];
  headers?: string[];
}) {
  return (
    <article className="chart agent-card">
      <div className="chart-heading">
        <h3>{title}</h3>
        <span className="badge">{source}</span>
      </div>
      <p className="muted">
        As of {at === undefined ? 'unavailable' : displayTime(at)}
      </p>
      <div role="img" aria-label={summary} tabIndex={0}>
        {children}
      </div>
      <details>
        <summary>Show data · {title}</summary>
        <div className="chart-table">
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
