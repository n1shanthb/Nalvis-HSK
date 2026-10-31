import { z } from 'zod';
export type Role = 'strategist' | 'fitter';
export type CompletionRequest = { role: Role; system: string; input: string };
export type Completion = {
  provider: string;
  model: string;
  rawOutput: string;
  latencyMs: number;
  usage: Record<string, unknown>;
  costUsdEst: number;
  costSource: string;
};
export interface Provider {
  id: string;
  isConfigured(): boolean;
  complete(request: CompletionRequest): Promise<Completion>;
}
const responseSchema = z.object({
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
          tool_calls: z.never().optional(),
        }),
      }),
    )
    .length(1),
  usage: z.record(z.unknown()).optional(),
});
/** Estimates are explicitly supplied per model; unknown cost fails closed for budget accounting. */
export function openRouter(
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch,
  estimates: Record<
    string,
    { inputPerMillion: number; outputPerMillion: number }
  > = {},
): Provider {
  return {
    id: 'openrouter',
    isConfigured: () =>
      Boolean(env.OPENROUTER_API_KEY?.trim() && env.STRATEGIST_MODEL?.trim()),
    async complete(request) {
      if (!this.isConfigured())
        throw new Error('Agent offline: OpenRouter key/model missing');
      const started = Date.now();
      const model =
        request.role === 'fitter'
          ? env.FITTER_MODEL || env.STRATEGIST_MODEL
          : env.STRATEGIST_MODEL;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await send(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
                ...(env.OPENROUTER_APP_URL
                  ? { 'HTTP-Referer': env.OPENROUTER_APP_URL }
                  : {}),
                ...(env.OPENROUTER_APP_NAME
                  ? { 'X-Title': env.OPENROUTER_APP_NAME }
                  : {}),
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: request.system },
                  { role: 'user', content: request.input },
                ],
                temperature: 0,
                response_format: { type: 'json_object' },
              }),
              signal: AbortSignal.timeout(20000),
            },
          );
          if (
            (response.status === 429 || response.status >= 500) &&
            attempt === 0
          ) {
            await response.body?.cancel();
            continue;
          }
          if (!response.ok)
            throw new Error(`OpenRouter HTTP ${response.status}`);
          const result = responseSchema.parse(await response.json()),
            usage = result.usage ?? {};
          const cost = usage.cost ?? usage.total_cost;
          const rate = estimates[result.model];
          const estimated = rate
            ? (Number(usage.prompt_tokens ?? 0) * rate.inputPerMillion +
                Number(usage.completion_tokens ?? 0) * rate.outputPerMillion) /
              1e6
            : undefined;
          // Unknown cost conservatively consumes the default daily budget, never silently free.
          const costUsdEst =
            typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
              ? cost
              : (estimated ?? 1);
          return {
            provider: 'openrouter',
            model: result.model,
            rawOutput: result.choices[0].message.content,
            latencyMs: Date.now() - started,
            usage,
            costUsdEst,
            costSource:
              typeof cost === 'number'
                ? 'openrouter usage.cost'
                : rate
                  ? `per-model estimate: ${result.model}`
                  : `unknown model cost: ${result.model}; conservative $1 reserve`,
          };
        } catch (e) {
          if (
            attempt === 0 &&
            e instanceof Error &&
            ['TimeoutError', 'AbortError'].includes(e.name)
          )
            continue;
          // Do not propagate arbitrary transport/provider text, which may contain credentials.
          throw new Error('OpenRouter completion unavailable or invalid');
        }
      }
      throw new Error('OpenRouter completion unavailable');
    },
  };
}
