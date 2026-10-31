// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { BudgetStore } from '../server/budget.js';
const credits = {
  remaining: 19,
  globalRemaining: 199,
  resetAt: 1900000000,
  retryAfter: 0,
};
const budget = (): BudgetStore => ({
  check: vi.fn().mockResolvedValue({ allowed: true, credits }),
});
import { createDeskHandler } from '../server/desk.js';
const env = {
  DESK_AI_ENABLED: 'true',
  VERCEL: '1',
  DESK_IP_HASH_SECRET: 'x'.repeat(32),
  GROQ_API_KEY: 'test-only-placeholder',
  GROQ_MODEL: 'configured-model',
  OPENROUTER_API_KEY: 'test-only-placeholder',
  OPENROUTER_MODEL: 'configured-router-model',
};
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://nalvis.example/api/desk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: 'https://nalvis.example',
      'x-vercel-forwarded-for': '192.0.2.1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
const completion = (content: string) =>
  Response.json({ choices: [{ message: { content } }] });
describe('server-only language translation', () => {
  it('reports availability without exposing keys and makes no unconfigured requests', async () => {
    const send = vi.fn();
    const handle = createDeskHandler({}, send, budget());
    expect(
      await (
        await handle(new Request('https://nalvis.example/api/desk'))
      ).json(),
    ).toEqual({
      providers: [
        { id: 'groq', available: false },
        { id: 'openrouter', available: false },
      ],
      credits: null,
      status: 'disabled',
    });
    expect(
      (await handle(request({ provider: 'groq', text: 'hello' }))).status,
    ).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
  for (const provider of ['groq', 'openrouter'])
    it(`uses the fixed ${provider} endpoint and returns only a validated command with hashes`, async () => {
      const send = vi
        .fn()
        .mockResolvedValue(completion('{"command":"show positions"}'));
      const response = await createDeskHandler(
        env,
        send,
        budget(),
      )(request({ provider, text: 'How is my portfolio doing?' }));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.command).toBe('show positions');
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.outputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(send.mock.calls[0][0]).toBe(
        provider === 'groq'
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions',
      );
      const options = send.mock.calls[0][1];
      expect(options.headers.Authorization).toBe(
        'Bearer test-only-placeholder',
      );
      expect(JSON.parse(options.body).model).toBe(
        provider === 'groq' ? env.GROQ_MODEL : env.OPENROUTER_MODEL,
      );
      expect(JSON.stringify(result)).not.toContain('test-only-placeholder');
    });
  for (const content of [
    '{"command":"send money"}',
    '{"command":"pause","transaction":"injected"}',
    'not json',
    '{"command":"mat karo"}',
  ])
    it(`rejects unsafe or malformed output: ${content}`, async () => {
      const response = await createDeskHandler(
        env,
        vi.fn().mockResolvedValue(completion(content)),
        budget(),
      )(request({ provider: 'groq', text: 'hello' }));
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  it('rejects tools, foreign origins, excessive bodies and client model overrides', async () => {
    const send = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          { message: { content: '{"command":"pause"}', tool_calls: [] } },
        ],
      }),
    );
    const handle = createDeskHandler(env, send, budget());
    expect(
      (await handle(request({ provider: 'groq', text: 'pause' }))).status,
    ).toBe(502);
    expect(
      (
        await handle(
          request(
            { provider: 'groq', text: 'pause' },
            { origin: 'https://evil.example' },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handle(request({ provider: 'groq', text: 'x'.repeat(5000) })))
        .status,
    ).toBe(413);
    expect(
      (
        await handle(
          request({ provider: 'groq', text: 'pause', model: 'override' }),
        )
      ).status,
    ).toBe(400);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not call a provider when shared limits or credits are exhausted', async () => {
    const send = vi.fn();
    const store: BudgetStore = {
      check: vi.fn().mockResolvedValue({
        allowed: false,
        credits: { ...credits, remaining: 0, retryAfter: 60 },
      }),
    };
    const r = await createDeskHandler(
      env,
      send,
      store,
    )(request({ provider: 'groq', text: 'pause' }));
    expect(r.status).toBe(429);
    expect((await r.json()).credits.remaining).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('redacts provider errors and keeps the consumed credit', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(
        Response.json({ secret: 'do not expose' }, { status: 401 }),
      );
    const store = budget();
    const r = await createDeskHandler(
      env,
      send,
      store,
    )(request({ provider: 'groq', text: 'pause' }));
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.credits).toEqual(credits);
    expect(JSON.stringify(body)).not.toContain('do not expose');
    expect(store.check).toHaveBeenCalledWith(expect.any(String), true);
  });
  it('requires shared storage, explicit enablement, a trusted IP and an Origin', async () => {
    const send = vi.fn();
    expect(
      (
        await createDeskHandler(
          env,
          send,
        )(request({ provider: 'groq', text: 'pause' }))
      ).status,
    ).toBe(503);
    expect(
      (
        await createDeskHandler(
          { ...env, DESK_AI_ENABLED: undefined },
          send,
          budget(),
        )(request({ provider: 'groq', text: 'pause' }))
      ).status,
    ).toBe(503);
    expect(
      (
        await createDeskHandler(
          { ...env, VERCEL: undefined },
          send,
          budget(),
        )(
          request(
            { provider: 'groq', text: 'pause' },
            { 'x-forwarded-for': '192.0.2.1' },
          ),
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await createDeskHandler(
          env,
          send,
          budget(),
        )(request({ provider: 'groq', text: 'pause' }, { origin: '' }))
      ).status,
    ).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it('fails closed on shared store errors and GET never returns model names', async () => {
    const send = vi.fn(),
      store: BudgetStore = {
        check: vi.fn().mockRejectedValue(Error('secret store failure')),
      };
    const handle = createDeskHandler(env, send, store);
    expect(
      (await handle(request({ provider: 'groq', text: 'pause' }))).status,
    ).toBe(503);
    const r = await createDeskHandler(
      env,
      send,
      budget(),
    )(
      new Request('https://nalvis.example/api/desk', {
        headers: { 'x-vercel-forwarded-for': '192.0.2.1' },
      }),
    );
    const body = await r.json();
    expect(body.credits.remaining).toBe(19);
    expect(body.providers[0].available).toBe(true);
    expect(JSON.stringify(body)).not.toContain('model');
    expect(send).not.toHaveBeenCalled();
  });
  it('disables both providers with the server kill switch', async () => {
    const send = vi.fn();
    expect(
      (
        await createDeskHandler(
          { ...env, DESK_AI_ENABLED: 'false' },
          send,
          budget(),
        )(request({ provider: 'groq', text: 'pause' }))
      ).status,
    ).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
});

it('does not let AI reinterpret mat karo as an owner action', async () => {
  const send = vi.fn().mockResolvedValue(completion('{"command":"pause"}'));
  const store = budget();
  const result = await createDeskHandler(
    env,
    send,
    store,
  )(request({ provider: 'groq', text: 'mat karo' }));
  expect(result.status).toBe(422);
  expect(send).not.toHaveBeenCalled();
  expect(store.check).not.toHaveBeenCalled();
});
