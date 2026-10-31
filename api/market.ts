import { z } from 'zod';
import { endpoints } from '../packages/core/src/evidence.js';
const mexcSchema = z.object({ bidPrice: z.string(), askPrice: z.string() }).passthrough();
const gateSchema = z.array(z.object({ highest_bid: z.string(), lowest_ask: z.string() }).passthrough());
export function createMarketHandler(fetcher: typeof fetch = fetch, now = Date.now) {
  let cached: { at: number; data: { mexc: unknown; gate: unknown } } | undefined;
  let pending: Promise<{ mexc: unknown; gate: unknown }> | undefined;
  return async (request: Request) => {
    if (request.method !== 'GET') return Response.json({ error: 'Use GET' }, { status: 405, headers: { Allow: 'GET' } });
    const venue = new URL(request.url).searchParams.get('venue');
    if (venue && venue !== 'mexc' && venue !== 'gate') return Response.json({ error: 'Unknown venue' }, { status: 400 });
    try {
      if (!cached || now() - cached.at >= 5000) {
        pending ??= Promise.all([endpoints.mexc, endpoints.gate].map(async (url) => {
          const r = await fetcher(url, { signal: AbortSignal.timeout(3000) });
          if (!r.ok) throw Error('Upstream unavailable');
          return r.json();
        })).then(([mexc, gate]) => ({ mexc: mexcSchema.parse(mexc), gate: gateSchema.parse(gate) }));
        try { cached = { at: now(), data: await pending }; } finally { pending = undefined; }
      }
      return Response.json(cached.data, { headers: { 'Cache-Control': 'public, max-age=5' } });
    } catch { return Response.json({ error: 'Market sources unavailable. Please retry shortly.' }, { status: 502 }); }
  };
}
export const handleMarketRequest = createMarketHandler();
export default { fetch: handleMarketRequest };
