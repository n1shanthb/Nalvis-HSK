import { useCallback } from 'react';
import { demoContext } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
export function RecordedVaultValue() {
  const resource = useResource(useCallback(demoContext, []));
  return (
    <article>
      <span>Recorded vault value (USDT)</span>
      <strong>
        {resource.data?.portfolio.portfolioUSD.toFixed(2) ??
          'Replaying recording…'}
      </strong>
      <small>Local Anvil inventory reconstruction; prices are not real.</small>
    </article>
  );
}
