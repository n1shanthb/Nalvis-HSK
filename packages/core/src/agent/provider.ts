import { z } from 'zod';
import {
  modelRates,
  defaultTokenRates,
  type TokenRates,
} from './config/model-rates.js';
export type Role = 'strategist' | 'fitter';
export type CompletionRequest = { role: Role; system: string; input: string };
export type Completion = {
  provider: string;
  model: string;
  rawOutput: string;
  latencyMs: number;
  usage: Record<string, unknown>;
  costUsdEst: number;
  costSource: 'openrouter' | 'estimate';
  costEstimate?: TokenRates & {
    rateSource: 'model' | 'custom' | 'default';
    model: string;
    inputTokens: number;
    outputTokens: number;
    tokenSource: 'usage' | 'usage-and-byte-estimate';
  };
};
export interface Provider {
  models?: { strategist: string; fitter: string };
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
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().finite().nonnegative().nullable().optional(),
      total_cost: z.number().finite().nonnegative().nullable().optional(),
    })
    .passthrough()
    .optional(),
});
/** Reported usage cost wins; otherwise charge labelled per-token estimates. */
export function openRouter(
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch,
  estimates: Record<string, TokenRates> = {},
): Provider {
  return {
    id: 'openrouter',
    models: {
      strategist: env.STRATEGIST_MODEL ?? '',
      fitter: env.FITTER_MODEL || env.STRATEGIST_MODEL || '',
    },
    isConfigured: () =>
      Boolean(
        env.AGENT_OPENROUTER_API_KEY?.trim() && env.STRATEGIST_MODEL?.trim(),
      ),
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
                Authorization: `Bearer ${env.AGENT_OPENROUTER_API_KEY}`,
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
                // Haiku 5.5 endpoints reject temperature with strict routing.
                ...(model === 'anthropic/claude-haiku-5.5'
                  ? {}
                  : { temperature: 0 }),
                response_format: { type: 'json_object' },
                provider: { require_parameters: true },
                reasoning: { effort: 'low', exclude: true },
                usage: { include: true },
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
          const custom = estimates[result.model],
            known = modelRates[result.model];
          const rate = z
            .object({
              inputPerMillion: z.number().finite().nonnegative(),
              outputPerMillion: z.number().finite().nonnegative(),
            })
            .parse(custom ?? known ?? defaultTokenRates);
          // Missing token counts use a conservative one-token-per-UTF-8-byte bound,
          // plus message framing; absent usage never becomes a free completion.
          const inputTokens =
            usage.prompt_tokens ??
            Buffer.byteLength(request.system + request.input) + 128;
          const outputTokens =
            usage.completion_tokens ??
            Buffer.byteLength(result.choices[0].message.content);
          const estimated =
            (inputTokens * rate.inputPerMillion +
              outputTokens * rate.outputPerMillion) /
            1e6;
          const costUsdEst = cost ?? estimated;
          return {
            provider: 'openrouter',
            model: result.model,
            rawOutput: result.choices[0].message.content,
            latencyMs: Date.now() - started,
            usage,
            costUsdEst,
            costSource:
              cost === undefined || cost === null ? 'estimate' : 'openrouter',
            ...(cost === undefined || cost === null
              ? {
                  costEstimate: {
                    ...rate,
                    rateSource: custom
                      ? ('custom' as const)
                      : known
                        ? ('model' as const)
                        : ('default' as const),
                    model: result.model,
                    inputTokens,
                    outputTokens,
                    tokenSource:
                      usage.prompt_tokens !== undefined &&
                      usage.completion_tokens !== undefined
                        ? ('usage' as const)
                        : ('usage-and-byte-estimate' as const),
                  },
                }
              : {}),
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
