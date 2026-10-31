import { useState, useCallback } from 'react';
import { formatUnits } from 'viem';
import { demoContext, demoEvidence, demoReceipts } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
import { displayTime } from '../lib/clients.js';
import { MarketChart } from './MarketChart.js';
export function Overview() {
  const r = useResource(useCallback(demoContext, []));
  const [selected, setSelected] = useState(demoReceipts.length - 1);
  const current = demoReceipts[selected];
  const lastExecutable = [...demoReceipts]
    .reverse()
    .find((r) => ['TRADE', 'RESIZE'].includes(r.decision.kind));
  const e = demoEvidence.at(-1)!;
  const p = r.data?.portfolio,
    m = r.data?.mandate;
  const cap = m ? Number(formatUnits(m.maxTradeInB, e.decimalsB)) : 0;
  const used = lastExecutable?.decision.sizeB ?? 0;
  return (
    <section className="overview">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONTROL PLANE / RECORDED SESSION</p>
          <h2>Your mandate. In focus.</h2>
          <p>
            A clear view of the limits, the evidence, and every decision in
            between.
          </p>
        </div>
        <a className="button console-button" href="#/desk">
          Ask the desk <span>↗</span>
        </a>
      </div>
      {r.error && <p role="alert">Recording unavailable — {r.error}</p>}
      <div className="overview-stats">
        <article className="stat-card">
          <span className="micro-label">
            RECEIPT INTEGRITY <i className="status-light" />
          </span>
          <strong>
            {r.data?.results.filter((r) => r.status === 'PASS').length ?? '—'}{' '}
            <small>/ {demoReceipts.length}</small>
          </strong>
          <span>Independent recorded RPC replay</span>
        </article>
        <article className="stat-card">
          <span className="micro-label">P&L VS HOLD · AFTER GAS</span>
          <strong>
            {p
              ? `${p.excessVsHoldUSD < 0 ? '−' : ''}$${Math.abs(p.excessVsHoldUSD).toFixed(4)}`
              : 'Verifying…'}
          </strong>
          <span>Local simulation · no proven edge</span>
        </article>
        <article className="stat-card">
          <span className="micro-label">PER-TRADE ENVELOPE</span>
          <strong>
            {m ? formatUnits(m.maxTradeInB, e.decimalsB) : '—'}{' '}
            <small>USDT</small>
          </strong>
          <span>Last recorded mandate · owner-defined</span>
        </article>
      </div>
      <div className="overview-grid">
        <div className="overview-chart">
          <MarketChart points={demoEvidence} />
          <div className="chart-footer">
            <span>
              <i className="status-light" /> Mainnet evidence · captured
              observations
            </span>
            <span>{displayTime(e.now)}</span>
          </div>
        </div>
        <article className="guardrail-panel">
          <div className="panel-heading">
            <h3>Mandate guardrails</h3>
            <span className="outline-tag">BOUNDED</span>
          </div>
          <p>The last executable intent stayed inside its recorded envelope.</p>
          <div className="limit-row">
            <div>
              <span>
                Trade cap used · #{String(lastExecutable?.seq ?? '—')}
              </span>
              <b>
                {used} / {cap || '—'} USDT
              </b>
            </div>
            <progress max={cap || 1} value={Math.min(used, cap)} />
          </div>
          <div className="limit-row">
            <div>
              <span>Slippage allowance</span>
              <b>{m?.maxSlippageBps ?? '—'} bps</b>
            </div>
            <progress max={100} value={m?.maxSlippageBps ?? 0} />
          </div>
          <div className="boundary-row">
            <span>Mandate status</span>
            <b>
              {m
                ? m.expiry <= Math.floor(Date.now() / 1000)
                  ? 'Expired · historical'
                  : 'Active'
                : 'Verifying…'}
            </b>
          </div>
          <div className="boundary-row">
            <span>Execution boundary</span>
            <b>Local Anvil · 31337</b>
          </div>
          <a className="subtle-link" href="#/receipts">
            Inspect the execution trail ↗
          </a>
        </article>
      </div>
      <div className="overview-bottom">
        <article className="stream-panel">
          <div className="panel-heading">
            <h3>Decision stream</h3>
            <a href="#/receipts">View all ↗</a>
          </div>
          {demoReceipts.map((receipt, i) => (
            <button
              key={receipt.receiptHash}
              className={`stream-row ${selected === i ? 'selected' : ''}`}
              onClick={() => setSelected(i)}
              aria-pressed={selected === i}
            >
              <span className={`verdict-dot ${receipt.decision.kind}`} />
              <span>
                Receipt #{String(receipt.seq)}
                <small>
                  {new Date(
                    Number(receipt.evidence.now) * 1000,
                  ).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  IST
                </small>
              </span>
              <span className={`badge ${receipt.decision.kind}`}>
                {receipt.decision.kind}
              </span>
            </button>
          ))}
        </article>
        <article className="quality-panel">
          <div className="panel-heading">
            <h3>Evidence quality</h3>
            <span>◈</span>
          </div>
          <div className="quality-row">
            <span>DEX observation</span>
            <b>{e.dexMid ? 'Captured' : 'Unavailable'}</b>
          </div>
          <div className="quality-row">
            <span>CEX venues</span>
            <b className={e.cex.length === 2 ? '' : 'status-warn'}>
              {e.cex.length} / 2 available
            </b>
          </div>
          <div className="quality-row">
            <span>Stress model</span>
            <b>±σ worst case</b>
          </div>
          <div className="quality-row">
            <span>Volatility source</span>
            <b>Frozen · 27 Oct 2026</b>
          </div>
          <p>
            Missing evidence can stop execution. The recorded REJECT shows that
            boundary working.
          </p>
        </article>
        <article className="proof-panel">
          <div className="panel-heading">
            <h3>Selected receipt</h3>
            <span className={`badge ${current.decision.kind}`}>
              {current.decision.kind}
            </span>
          </div>
          <span className="micro-label">
            HASH-CHAINED COMMITMENT / #{String(current.seq)}
          </span>
          <code>{current.receiptHash}</code>
          <p>
            {current.ruleTrace.find((t) => !t.pass)?.detail ??
              current.ruleTrace.at(-1)?.detail}
          </p>
          <details>
            <summary>Inspect the rule trace</summary>
            {current.ruleTrace.map((t, i) => (
              <p key={i}>
                {t.pass ? 'PASS' : 'FAIL'} · {t.rule}: {t.detail}
              </p>
            ))}
          </details>
          <a href="#/verify">Open independent verification ↗</a>
        </article>
      </div>
      <p className="overview-note">
        Recorded local Anvil session. Prices are not real.{' '}
        {p?.assumptions ??
          'Portfolio metrics appear after receipt verification.'}
      </p>
    </section>
  );
}
