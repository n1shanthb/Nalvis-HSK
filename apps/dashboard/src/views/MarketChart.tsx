import { lazy, Suspense } from 'react';
import type { Evidence } from '../../../../packages/core/src/types.js';
const BasisChart = lazy(() => import('../components/charts/BasisChart.js'));
/** Recorded console compatibility; the landing uses the mainnet fixture directly. */
export function MarketChart({ points }: { points: Evidence[] }) {
  return (
    <Suspense fallback={<p>Loading basis history…</p>}>
      <BasisChart points={points} demo />
    </Suspense>
  );
}
