// @vitest-environment node
import { it, expect, vi } from 'vitest';
import {
  clientIdentity,
  createBudgetStore,
  budgetScript,
} from '../server/budget.js';
const env = {
  UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-placeholder',
  DESK_IP_HASH_SECRET: 'x'.repeat(32),
};
it('uses one atomic EVAL for per-IP/global minute/day limits, with no raw IP keys', async () => {
  const send = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ result: [1, 19, 199, 1900000000, 0] }),
    );
  const store = createBudgetStore(env, send)!;
  const req = new Request('http://localhost/api/desk', {
    headers: {
      'x-forwarded-for': '198.51.100.1',
      'x-vercel-forwarded-for': '198.51.100.2',
    },
  });
  const id = clientIdentity(req, env, '127.0.0.1')!;
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  expect(clientIdentity(req, env)).toBeUndefined();
  const r = await store.check(id, true);
  expect(r).toEqual({
    allowed: true,
    credits: {
      remaining: 19,
      globalRemaining: 199,
      resetAt: 1900000000,
      retryAfter: 0,
    },
  });
  const args = JSON.parse(send.mock.calls[0][1].body);
  expect(args.slice(0, 3)).toEqual(['EVAL', budgetScript, 4]);
  expect(args.slice(7)).toEqual(['5', '30', '20', '200', '1']);
  expect(
    args.slice(3, 7).every((k: string) => k.startsWith('{nalvis-desk-v1}:')),
  ).toBe(true);
  expect(args.join('')).not.toContain('127.0.0.1');
  await store.check(id, false);
  expect(JSON.parse(send.mock.calls[1][1].body).at(-1)).toBe('0');
});
it('trusts only the platform IP on Vercel and normalizes local IPv4 mapping', () => {
  const req = (value: string) =>
    new Request('https://nalvis.example/api/desk', {
      headers: {
        'x-vercel-forwarded-for': value,
        'x-forwarded-for': '198.51.100.7',
      },
    });
  expect(clientIdentity(req('192.0.2.1'), { ...env, VERCEL: '1' })).toBe(
    clientIdentity(req('ignored'), env, '192.0.2.1'),
  );
  expect(
    clientIdentity(req('192.0.2.1,198.51.100.2'), { ...env, VERCEL: '1' }),
  ).toBeUndefined();
  expect(clientIdentity(req('ignored'), env, '::ffff:127.0.0.1')).toBe(
    clientIdentity(req('ignored'), env, '127.0.0.1'),
  );
});
it('invalid configuration, HTTP/store errors or malformed results never permit calls', async () => {
  expect(
    createBudgetStore({
      ...env,
      UPSTASH_REDIS_REST_URL: 'http://test.upstash.io',
    }),
  ).toBeUndefined();
  expect(
    createBudgetStore({ ...env, DESK_AI_GLOBAL_DAILY_CAP: '0' }),
  ).toBeUndefined();
  expect(
    createBudgetStore({ ...env, DESK_IP_HASH_SECRET: '' }),
  ).toBeUndefined();
  const send = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'internal' }))
    .mockResolvedValueOnce(Response.json({ result: [1, -1, 2, 3, 0] }))
    .mockRejectedValueOnce(Error('timeout'));
  const store = createBudgetStore(env, send)!;
  for (let i = 0; i < 3; i++)
    await expect(store.check('a'.repeat(64), true)).rejects.toThrow();
});
