import { expect, it, vi } from 'vitest';
import { createAgentFeedHandler } from '../server/agent-feed.js';
it('denies mutations, arbitrary paths and injected upstreams before making any request', async () => {
  const fetcher = vi.fn();
  const handler = createAgentFeedHandler('https://feed.example', fetcher);
  for (const [url, method, status] of [
    ['?path=/feed/state', 'POST', 405],
    ['?path=/../../agent.env', 'GET', 400],
    ['?path=https://evil.example', 'GET', 400],
    ['?path=/feed/state&upstream=http://evil.example', 'GET', 400],
    ['?path=/feed/journal&limit=999', 'GET', 400],
  ] as const)
    expect(
      (
        await handler(
          new Request('https://app.example/api/agent' + url, { method }),
        )
      ).status,
    ).toBe(status);
  expect(fetcher).not.toHaveBeenCalled();
});
it('relays allowed reads without forwarding credentials or origin and coalesces repeated reads', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ state: 'online' }));
  const handler = createAgentFeedHandler('https://feed.example/', fetcher);
  const request = new Request(
    'https://app.example/api/agent?path=/feed/actions&limit=50',
    { headers: { Authorization: 'private', Origin: 'https://app.example' } },
  );
  const [a, b] = await Promise.all([handler(request), handler(request)]);
  expect(a.status).toBe(200);
  expect(await b.json()).toEqual({ state: 'online' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://feed.example/feed/actions?limit=50',
  );
  expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
});
it('reports unavailable upstreams instead of substituting fixtures', async () => {
  const request = new Request('https://app.example/api/agent?path=/feed/state');
  expect((await createAgentFeedHandler(undefined)(request)).status).toBe(503);
  expect(
    (
      await createAgentFeedHandler(
        'https://feed.example',
        vi.fn().mockRejectedValue(Error('offline')),
      )(request)
    ).status,
  ).toBe(502);
});
it('uses only the operator token for the VM edge and never the browser credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const handler = createAgentFeedHandler(
    'http://vm.example:8788',
    fetcher,
    'test-relay-token',
  );
  await handler(
    new Request('https://app.example/api/agent?path=/feed/state', {
      headers: { Authorization: 'Bearer browser-value' },
    }),
  );
  expect(fetcher.mock.calls[0][1].headers).toEqual({
    Authorization: 'Bearer test-relay-token',
  });
});
