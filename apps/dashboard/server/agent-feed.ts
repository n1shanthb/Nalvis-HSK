/** Public, read-only relay. Upstream is operator configuration, never a request parameter. */
export function createAgentFeedHandler(
  upstream: string | undefined,
  fetcher: typeof fetch = fetch,
) {
  const cache = new Map<
    string,
    { until: number; body: string; status: number }
  >();
  const pending = new Map<string, Promise<{ body: string; status: number }>>();
  return async (request: Request): Promise<Response> => {
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const error = (status: number, message: string) =>
      Response.json({ error: message }, { status, headers });
    if (request.method !== 'GET') return error(405, 'Read-only feed: GET only');
    const params = new URL(request.url).searchParams;
    const path = params.get('path') ?? '';
    if (
      !/^\/feed\/(state|stats|watches|actions|journal|policy)$/.test(path) &&
      !/^\/feed\/(prompts|evidence|states|receipts)\/0x[\da-f]{64}$/i.test(path)
    )
      return error(400, 'Feed path denied');
    if (
      [...params.keys()].some(
        (key) => !['path', 'limit', 'after'].includes(key),
      )
    )
      return error(400, 'Query denied');
    const query = new URLSearchParams();
    const limit = params.get('limit');
    const after = params.get('after');
    if (limit !== null) {
      if (!/^[1-9]\d*$/.test(limit) || Number(limit) > 200)
        return error(400, 'Invalid limit');
      query.set('limit', limit);
    }
    if (after !== null) {
      if (!/^0x[\da-f]{64}$/i.test(after)) return error(400, 'Invalid cursor');
      query.set('after', after);
    }
    if (!upstream) return error(503, 'Live feed upstream is not configured');
    const key = path + (query.size ? '?' + query.toString() : '');
    try {
      let result = cache.get(key);
      if (!result || result.until < Date.now()) {
        let operation = pending.get(key);
        if (!operation) {
          operation = (async () => {
            const response = await fetcher(upstream.replace(/\/$/, '') + key, {
              signal: AbortSignal.timeout(7000),
              redirect: 'error',
            });
            const body = await response.text();
            if (body.length > 4_000_000) throw Error('Feed response too large');
            JSON.parse(body);
            return { body, status: response.status };
          })();
          pending.set(key, operation);
        }
        try {
          result = { ...(await operation), until: Date.now() + 5000 };
          if (result.status === 200) cache.set(key, result);
          if (cache.size > 256) cache.delete(cache.keys().next().value!);
        } finally {
          pending.delete(key);
        }
      }
      return new Response(result.body, { status: result.status, headers });
    } catch {
      return error(502, 'Live agent feed unavailable');
    }
  };
}
