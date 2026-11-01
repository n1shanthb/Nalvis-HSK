import { useCallback } from 'react';
import { demoContext, demoReceipts } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
import { lazy, Suspense } from 'react';
const BasisChart = lazy(() => import('../components/charts/BasisChart.js'));
export default function LandingPreview() {
  const r = useResource(useCallback(demoContext, []));
  const last = demoReceipts.at(-1)!;
  const rawReason = last.ruleTrace.find((t) => !t.pass)?.detail;
  const reason =
    rawReason === 'cex_missing'
      ? 'CEX evidence was unavailable. Execution was rejected.'
      : (rawReason ?? 'Inspect the recorded rule trace.');
  return (
    <div className="landing-preview">
      <div className="preview-mini-nav">
        <span className="mini-logo">N</span>
        <span className="active">◫</span>
        <span>⌁</span>
        <span>◇</span>
        <span>✓</span>
      </div>
      <div className="preview-data">
        <div className="preview-data-heading">
          <div>
            <span className="micro-label">WORKSPACE / RECORDED SESSION</span>
            <h3>Clarity at every step.</h3>
          </div>
          <a href="?demo=1#/mandate" className="preview-open">
            Open workspace ↗
          </a>
        </div>
        <div className="preview-stats">
          <div>
            <span>Receipt integrity</span>
            <strong>
              {r.data?.results.filter((x) => x.status === 'PASS').length ?? '—'}
              <small> / {demoReceipts.length}</small>
            </strong>
          </div>
          <div>
            <span>Decision engine</span>
            <strong>Deterministic</strong>
          </div>
          <div>
            <span>Execution chain</span>
            <strong>
              31337 <small>Local Anvil</small>
            </strong>
          </div>
        </div>
        <Suspense fallback={<p>Loading recorded mainnet history…</p>}>
          <BasisChart />
        </Suspense>
      </div>
      <aside className="preview-receipt">
        <span className="micro-label">LAST RECORDED DECISION</span>
        <span className={`badge ${last.decision.kind}`}>
          {last.decision.kind}
        </span>
        <h4>
          {last.decision.kind === 'REJECT'
            ? 'Execution blocked.'
            : 'Decision recorded.'}
        </h4>
        <p>{reason}</p>
        <div className="receipt-link-line" />
        <span className="micro-label">COMMITMENT</span>
        <code>{last.receiptHash.slice(0, 18)}…</code>
        <a href="?demo=1#/receipts">Inspect receipt #{String(last.seq)} ↗</a>
        <p className="preview-disclaimer">
          Offline replay. Synthetic market scenarios; local prices are not real.
        </p>
      </aside>
    </div>
  );
}
