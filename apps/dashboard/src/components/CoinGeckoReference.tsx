import { useCallback } from 'react';
import { z } from 'zod';
import { useResource } from '../lib/useResource.js';
// Public display-only reference requested by T11; never passed to the decision engine.
export function CoinGeckoReference() {
  const data = useResource(useCallback(async () => {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hashkey-ecopoints&vs_currencies=usd', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw Error('Reference unavailable');
    return z.object({ 'hashkey-ecopoints': z.object({ usd: z.number().positive() }) }).parse(await r.json())['hashkey-ecopoints'].usd;
  }, []));
  return <article><span>CoinGecko · display reference only</span><strong>{data.data ? `$${data.data}` : 'Reference unavailable'}</strong><small>Excluded from agent decisions</small></article>;
}
