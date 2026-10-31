import { Overview } from './Overview.js';
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
  if (route === 'mandate') return <Overview />;
  return (
    <section>
      <p className="eyebrow">RECORDED SESSION / LOCAL ANVIL</p>
      <h2>
        {route === 'evidence'
          ? 'Market evidence'
          : route === 'verify'
            ? 'Independent verification'
            : 'Decision timeline'}
      </h2>
      <p>
        {demoReceipts.length} recorded fork receipts. Offline RPC replay. Local
        anvil — prices not real. Captured {displayTime(demoEvidence[0].now)}.
      </p>
      {resource.loading && (
        <div className="skeleton" role="status">
          Replaying recorded evidence…
        </div>
      )}
      {resource.error && (
        <p role="alert">Verification unavailable: {resource.error}</p>
      )}
      {route === 'evidence' && <MarketChart points={demoEvidence} />}
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
          {r.version === 1
            ? 'Legacy recording: expiry and risk fields were not captured.'
            : `T8 v2: valid until ${displayTime(r.tx.validUntil!)}. ±σ worst-case stress uses frozen Oct 27 volatility.`}
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
