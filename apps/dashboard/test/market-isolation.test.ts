import { expect, test, vi } from 'vitest';
import { createMarketHandler } from '../server/market.js';
import { endpoints } from '../../../packages/core/src/evidence.js';
test('one venue failure preserves the other ticker and selected requests fetch only their venue', async () => {
  const fetcher = vi.fn(async (url: unknown) =>
    String(url) === endpoints.mexc
      ? new Response('private upstream body', { status: 403 })
      : Response.json([{ highest_bid: '1', lowest_ask: '2' }]),
  );
  const handler = createMarketHandler(fetcher);
  const result = await handler(new Request('https://example.test/api/market'));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    mexc: null,
    gate: [{ highest_bid: '1', lowest_ask: '2' }],
    errors: { mexc: 'HTTP 403' },
  });
  expect(
    (await handler(new Request('https://example.test/api/market?venue=mexc')))
      .status,
  ).toBe(502);
  const selected = createMarketHandler(fetcher);
  fetcher.mockClear();
  expect(
    (await selected(new Request('https://example.test/api/market?venue=gate')))
      .status,
  ).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(endpoints.gate);
});
