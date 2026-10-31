import { useCallback, useState } from 'react';
import { demoContext, demoEvidence, demoReceipts } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
import { displayTime } from '../lib/clients.js';
import { EvidenceDetails } from './Evidence.js';
import { MarketChart } from './MarketChart.js';
import type { Route } from '../App.js';
export function DemoConsole({ route }: { route: Route }) {
  const resource = useResource(useCallback(demoContext, []));
  const [selected, setSelected] = useState(0),
    r = demoReceipts[selected];
  return (
    <section>
      <p className="eyebrow">RECORDED SESSION / LOCAL ANVIL</p>
      <h2>
        {route === 'mandate'
          ? 'Execution overview'
          : route === 'evidence'
            ? 'Market evidence'
            : route === 'verify'
              ? 'Independent verification'
              : 'Decision timeline'}
      </h2>
      <p>
        Four recorded fork receipts. Offline RPC replay. Local anvil — prices
        not real. Captured {displayTime(demoEvidence[0].now)}.
      </p>
      {resource.loading && (
        <div className="skeleton" role="status">
          Replaying recorded evidence…
        </div>
      )}
      {resource.error && (
        <p role="alert">Verification unavailable: {resource.error}</p>
      )}
      {route === 'mandate' && (
        <>
          <div className="metrics">
            <article>
              <span>P&L vs hold · after gas</span>
              <strong>
                {resource.data
                  ? `$${resource.data.portfolio.excessVsHoldUSD.toFixed(4)}`
                  : 'Verifying…'}
              </strong>
              <small>No proven edge · recorded simulation</small>
            </article>
            <article>
              <span>Portfolio value</span>
              <strong>
                {resource.data
                  ? `$${resource.data.portfolio.portfolioUSD.toFixed(2)}`
                  : 'Verifying…'}
              </strong>
              <small>Last available CEX mark · assumed USD peg</small>
            </article>
            <article>
              <span>Verified decisions</span>
              <strong>
                {resource.data?.results.filter((r) => r.status === 'PASS')
                  .length ?? '—'}{' '}
                / 4
              </strong>
              <small>TRADE · WAIT · RESIZE · REJECT</small>
            </article>
          </div>
          {resource.data && (
            <>
              <h3>Recorded mandate · limits used</h3>
              <div className="metrics">
                <article>
                  <span>Trade cap / USDT</span>
                  <strong>
                    {Number(resource.data.mandate.maxTradeInB) / 1e6}
                  </strong>
                  <progress
                    max={Number(resource.data.mandate.maxTradeInB) / 1e6}
                    value={r.decision.sizeB ?? 0}
                  />
                  <small>
                    Receipt #{String(r.seq)} · {r.decision.sizeB ?? 0} USDT
                    requested
                  </small>
                </article>
                <article>
                  <span>Slippage allowance</span>
                  <strong>{resource.data.mandate.maxSlippageBps} bps</strong>
                  <progress
                    max={100}
                    value={resource.data.mandate.maxSlippageBps}
                  />
                  <small>100 bps contract ceiling</small>
                </article>
                <article>
                  <span>Mandate expiry</span>
                  <strong>Expired</strong>
                  <small>
                    {displayTime(resource.data.mandate.expiry)} · historical
                    recording
                  </small>
                </article>
              </div>
              <p className="muted">{resource.data.portfolio.assumptions}</p>
            </>
          )}
        </>
      )}
      {(route === 'evidence' || route === 'mandate') && (
        <MarketChart points={demoEvidence} />
      )}
      {route === 'evidence' && <EvidenceDetails e={demoEvidence[selected]} />}
      <h3>Decision timeline</h3>
      <div className="timeline">
        {demoReceipts.map((r, i) => (
          <button
            className={`timeline-item ${selected === i ? 'selected' : ''}`}
            key={r.receiptHash}
            onClick={() => setSelected(i)}
            aria-pressed={selected === i}
          >
            <span className={`badge ${r.decision.kind}`}>
              {r.decision.kind}
            </span>
            <span>
              #{String(r.seq)} · {displayTime(Number(r.evidence.now))}
            </span>
          </button>
        ))}
      </div>
      <article className="receipt">
        <h3>
          Receipt #{String(r.seq)}{' '}
          <span className={`badge ${r.decision.kind}`}>{r.decision.kind}</span>
        </h3>
        <p>{r.llm.explanation}</p>
        <code>{r.receiptHash}</code>
        <p>
          Transaction <code>{r.settlement?.transactionHash}</code>
        </p>
        <details open={route === 'receipts'}>
          <summary>Rule trace</summary>
          {r.ruleTrace.map((t, i) => (
            <p key={i}>
              <b>{t.pass ? 'PASS' : 'FAIL'}</b> · {t.rule}: {t.detail}
            </p>
          ))}
        </details>
        <p>
          Legacy recording: expiry and Monte Carlo fields were not captured. New
          keeper decisions include both.
        </p>
      </article>
      {route === 'verify' && resource.data && (
        <>
          <h3>
            {resource.data.results[selected].status} · recorded RPC replay
          </h3>
          <ul>
            {resource.data.results[selected].checks.map((c, i) => (
              <li key={i}>
                {c.pass ? 'PASS' : 'FAIL'} · {c.name}
                {c.detail ? ` — ${c.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
