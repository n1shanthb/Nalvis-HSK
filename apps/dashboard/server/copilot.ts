import { z } from 'zod';
import {
  assertSellAuthorization,
  sellSessionSchema,
  signedSellOrderSchema,
} from '../../../packages/core/src/copilot.js';
import { copilotQueue } from '../../../packages/core/src/copilot-queue.js';
import { copilotPreview, copilotState } from './copilot-rpc.js';
export function createCopilotHandler(
  env: Record<string, string | undefined> = process.env,
  deps = {
    state: copilotState,
    preview: copilotPreview,
    queue: copilotQueue(env),
  },
) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  return async (request: Request) => {
    try {
      if (request.method === 'GET') {
        const id = new URL(request.url).searchParams.get('id');
        if (id)
          return json(
            (await deps.queue?.status(id)) ?? { status: 'unavailable' },
          );
        const { state, owner } = await deps.state();
        return json({
          chainId: state.chainId,
          vault: state.vault,
          owner,
          policyHash: state.mandate.policyHash,
          now: state.blockTime,
          balanceA: String(state.balanceA),
          balanceB: String(state.balanceB),
          decimalsA: state.decimalsA,
          decimalsB: state.decimalsB,
          enabled: env.COPILOT_TRADES_ENABLED === 'true' && !!deps.queue,
        });
      }
      if (request.method !== 'POST')
        return json({ error: 'POST required' }, 405);
      if (request.headers.get('origin') !== new URL(request.url).origin)
        return json({ error: 'Same-origin confirmation required' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return json({ error: 'JSON required' }, 415);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'Request required' }, 400);
      let size = 0,
        text = '';
      const decoder = new TextDecoder();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return json({ error: 'Request too large' }, 413);
        }
        text += decoder.decode(part.value, { stream: true });
      }
      const body = JSON.parse(text + decoder.decode());
      if (body.op === 'preview') {
        const input = z
          .object({
            op: z.literal('preview'),
            session: sellSessionSchema,
            direction: z.enum(['BUY', 'SELL']).optional(),
            notionalB: z.string().optional(),
          })
          .strict()
          .parse(body);
        return json(await deps.preview(input.session, { direction: input.direction, notionalB: input.notionalB }));
      }
      const input = z
        .object({ op: z.literal('confirm'), signed: signedSellOrderSchema })
        .strict()
        .parse(body);
      if (env.COPILOT_TRADES_ENABLED !== 'true' || !deps.queue)
        return json({ error: 'Reviewed owner trading is not enabled' }, 503);
      const { state, owner } = await deps.state();
      const signed = await assertSellAuthorization(input.signed, {
        owner,
        vault: state.vault,
        chainId: state.chainId,
        policyHash: state.mandate.policyHash,
        now: state.blockTime,
      });
      // The worker independently repeats signatures, fresh mandate checks and simulation.
      const id = await deps.queue.enqueue(signed);
      return json(
        {
          id,
          status: 'queued',
          message:
            'Accepted for independent keeper rechecks; this is not a swap confirmation.',
        },
        202,
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error &&
            /^(Preview failed at (?:session validation|vault state|pool fee|DEX quote|mandate limits|swap simulation|gas estimate|preview response)\. No order was submitted\.|already submitted|in progress)/.test(error.message)
              ? error.message
              : 'Request failed validation, authorization, freshness or current mandate checks. Refresh the review.',
        },
        400,
      );
    }
  };
}
