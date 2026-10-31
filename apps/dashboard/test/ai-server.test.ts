// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createDeskHandler } from '../server/desk.js';
const env = {
  GROQ_API_KEY: 'test-only-placeholder',
  GROQ_MODEL: 'configured-model',
  OPENROUTER_API_KEY: 'test-only-placeholder',
  OPENROUTER_MODEL: 'configured-router-model',
};
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://nalvis.example/api/desk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const completion = (content: string) =>
  Response.json({ choices: [{ message: { content } }] });
describe('server-only language translation', () => {
  it('reports availability without exposing keys and makes no unconfigured requests', async () => {
    const send = vi.fn();
    const handle = createDeskHandler({}, send);
    expect(
      await (
        await handle(new Request('https://nalvis.example/api/desk'))
      ).json(),
    ).toEqual({
      providers: [
        { id: 'groq', available: false, model: null },
        { id: 'openrouter', available: false, model: null },
      ],
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
  ])
    it(`rejects unsafe or malformed output: ${content}`, async () => {
      const response = await createDeskHandler(
        env,
        vi.fn().mockResolvedValue(completion(content)),
      )(request({ provider: 'groq', text: 'hello' }));
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  it('rejects tools, foreign origins, excessive bodies and client model overrides', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [
            { message: { content: '{"command":"pause"}', tool_calls: [] } },
          ],
        }),
      );
    const handle = createDeskHandler(env, send);
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
  it('bounds provider calls and redacts upstream failures', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(
        Response.json({ secret: 'do not expose' }, { status: 401 }),
      );
    const handle = createDeskHandler(env, send);
    const r = await handle(request({ provider: 'groq', text: 'pause' }));
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain('do not expose');
    for (let i = 1; i < 15; i++)
      await handle(request({ provider: 'groq', text: 'pause' }));
    expect(
      (await handle(request({ provider: 'groq', text: 'pause' }))).status,
    ).toBe(429);
    expect(send).toHaveBeenCalledTimes(15);
  });
  it('disables both providers with the server kill switch', async () => {
    const send = vi.fn();
    expect(
      (
        await createDeskHandler(
          { ...env, DESK_AI_ENABLED: 'false' },
          send,
        )(request({ provider: 'groq', text: 'pause' }))
      ).status,
    ).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
});
