import { z } from 'zod';
import { endpoints } from '../../../packages/core/src/evidence.js';
const schemas = {
  mexc: z.object({ bidPrice: z.string(), askPrice: z.string() }).passthrough(),
  gate: z.array(
    z.object({ highest_bid: z.string(), lowest_ask: z.string() }).passthrough(),
  ),
};
type Venue = keyof typeof schemas;
type Result = { data: unknown | null; error?: string };
export function createMarketHandler(
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  const cache = new Map<Venue, { at: number; result: Result }>();
  const pending = new Map<Venue, Promise<Result>>();
  async function ticker(venue: Venue): Promise<Result> {
    const cached = cache.get(venue);
    if (cached && now() - cached.at < 5000) return cached.result;
    const active = pending.get(venue);
    if (active) return active;
    const request = (async (): Promise<Result> => {
      try {
        const response = await fetcher(endpoints[venue], {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok)
          return { data: null, error: `HTTP ${response.status}` };
        const parsed = schemas[venue].safeParse(await response.json());
        return parsed.success
          ? { data: parsed.data }
          : { data: null, error: 'Invalid ticker' };
      } catch (e) {
        return {
          data: null,
          error:
            e instanceof Error && /timeout|abort/i.test(e.name)
              ? 'timeout'
              : 'unavailable',
        };
      }
    })();
    pending.set(venue, request);
    try {
      const result = await request;
      cache.set(venue, { at: now(), result });
      return result;
    } finally {
      pending.delete(venue);
    }
  }
  return async (request: Request) => {
    if (request.method !== 'GET')
      return Response.json(
        { error: 'Use GET' },
        { status: 405, headers: { Allow: 'GET' } },
      );
    const venue = new URL(request.url).searchParams.get('venue');
    if (venue && venue !== 'mexc' && venue !== 'gate')
      return Response.json({ error: 'Unknown venue' }, { status: 400 });
    const venues: Venue[] = venue ? [venue] : ['mexc', 'gate'];
    const results = await Promise.allSettled(venues.map(ticker));
    const body: {
      mexc: unknown;
      gate: unknown;
      errors: Partial<Record<Venue, string>>;
    } = { mexc: null, gate: null, errors: {} };
    results.forEach((r, i) => {
      const v = venues[i];
      const result =
        r.status === 'fulfilled'
          ? r.value
          : { data: null, error: 'unavailable' };
      body[v] = result.data;
      if (result.error) body.errors[v] = result.error;
    });
    const failed = venue
      ? !!body.errors[venue]
      : venues.every((v) => !!body.errors[v]);
    return Response.json(body, {
      status: failed ? 502 : 200,
      headers: { 'Cache-Control': 'public, max-age=5' },
    });
  };
}
export const handleMarketRequest = createMarketHandler();
export default { fetch: handleMarketRequest };
