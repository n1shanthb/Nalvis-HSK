import { lazy, Suspense, useCallback } from 'react';
const VaultChart = lazy(() => import('./charts/VaultChart.js'));
import { demoContext } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
export function RecordedVaultValue() {
  const resource = useResource(useCallback(demoContext, []));
  return (
    <>
      <Suspense fallback={<p>Loading recorded vault history…</p>}>
        <VaultChart results={resource.data?.results} demo />
      </Suspense>
      <article className="reference-tile">
        <span>Recorded vault value (USDT)</span>
        <strong>
          {resource.data?.portfolio.portfolioUSD.toFixed(2) ??
            'Replaying recording…'}
        </strong>
        <small>
          Local Anvil inventory reconstruction; prices are not real.
        </small>
      </article>
    </>
  );
}
