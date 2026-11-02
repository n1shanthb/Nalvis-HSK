import { lazy, Suspense, useCallback } from 'react';
const VaultChart = lazy(() => import('../components/charts/VaultChart.js'));
import { liveDeskContext } from '../lib/desk-context.js';
import { useResource } from '../lib/useResource.js';
import type { DashboardChain } from '../lib/clients.js';
export function Portfolio({ chain }: { chain: DashboardChain }) {
  const r = useResource(useCallback(() => liveDeskContext(chain), [chain]));
  if (r.loading)
    return (
      <div role="status" className="skeleton">
        Verifying portfolio receipts…
      </div>
    );
  if (!r.data?.portfolio)
    return (
      <p>
        Portfolio unavailable:{' '}
        {r.error ??
          'serve a contiguous verified receipt history to compute P&L vs hold.'}
      </p>
    );
  const p = r.data.portfolio;
  return (
    <>
      {r.error && (
        <p role="status">
          Portfolio refresh failed; showing last verified history.
        </p>
      )}
      <Suspense fallback={<p>Loading vault history…</p>}>
        <VaultChart results={r.data.results} chain={chain} />
      </Suspense>
      <div className="metrics">
        <article>
          <span>P&L vs hold · after gas</span>
          <strong>${p.excessVsHoldUSD.toFixed(4)}</strong>
          <small>{p.label} · no proven edge</small>
        </article>
        <article>
          <span>Reconstructed WHSK / USDT</span>
          <strong>
            {p.balanceA.toFixed(4)} / {p.balanceB.toFixed(4)}
          </strong>
          <small>Assumes no deposits or withdrawals between receipts</small>
        </article>
      </div>
      <p className="muted">
        {p.label}. Inventory reconstructed using verifier P&L; current vault
        balances may differ after external transfers.
      </p>
    </>
  );
}
