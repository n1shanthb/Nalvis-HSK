import { z } from 'zod';
export const schemaVersion = 1;
export const natural = z.number().int().nonnegative().safe();
export const decimal = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .refine((v) => /[1-9]/.test(v), 'positive decimal required');
const source = z.enum(['dex', 'cex', 'apro']);
export const watchKindSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('price_move_pct'),
        source,
        refPrice: decimal,
        pct: z.number().finite().positive(),
        dir: z.enum(['up', 'down', 'either']),
      })
      .strict(),
    z
      .object({
        type: z.literal('price_cross'),
        source,
        level: decimal,
        dir: z.enum(['above', 'below']),
      })
      .strict(),
    z
      .object({
        type: z.literal('liquidity_change_pct'),
        refLiquidity: decimal,
        pct: z.number().finite().positive(),
      })
      .strict(),
    z
      .object({
        type: z.literal('basis_bps'),
        thresholdBps: z.number().finite().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal('swap_activity'),
        windowMin: z.number().finite().positive(),
        minSwaps: natural.optional(),
        minUsd: z.number().finite().nonnegative().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('time'),
        at: natural.optional(),
        everySec: natural.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('retry'),
        at: natural,
        legOf: z.string().optional(),
      })
      .strict(),
  ])
  .superRefine((k, ctx) => {
    if (
      k.type === 'time' &&
      (k.at === undefined) === (k.everySec === undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'exactly one of at/everySec required',
      });
    if (
      k.type === 'swap_activity' &&
      k.minSwaps === undefined &&
      k.minUsd === undefined
    )
      ctx.addIssue({ code: 'custom', message: 'activity threshold required' });
  });
export const watchDraftSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: watchKindSchema,
    note: z.string().max(200),
    cooldownSec: natural,
    expiresAt: natural.optional(),
  })
  .strict();
export const watchSchema = watchDraftSchema
  .extend({
    createdBy: z.enum(['strategist', 'system']),
    createdAt: natural,
    lastFiredAt: natural.optional(),
    fireCount: natural,
  })
  .strict();
export const actionSchema = z
  .object({
    type: z.enum(['BUY', 'SELL', 'HOLD']),
    notionalB: decimal.optional(),
    maxSlippageBps: z.number().int().min(0).max(10000).optional(),
    urgency: z.enum(['now', 'next_window']),
    reason: z.string().max(600),
  })
  .strict()
  .superRefine((a, c) => {
    if (a.type !== 'HOLD' && !a.notionalB)
      c.addIssue({ code: 'custom', message: 'BUY/SELL require notionalB' });
  });
export const watchChangesSchema = z
  .object({
    create: z.array(watchDraftSchema),
    update: z.array(
      z
        .object({
          id: z.string(),
          patch: watchDraftSchema.omit({ id: true }).partial().strict(),
          reason: z.string().max(200),
        })
        .strict(),
    ),
    delete: z.array(
      z.object({ id: z.string(), reason: z.string().max(200) }).strict(),
    ),
  })
  .strict();
export const strategistSchema = z
  .object({
    thesis: z.string().max(800),
    action: actionSchema,
    watches: watchChangesSchema,
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string().max(200)).max(6),
  })
  .strict();
export const legSchema = z
  .object({ notionalB: decimal, notBefore: natural })
  .strict();
export const fitterSchema = z
  .object({
    proposal: z
      .object({
        type: z.enum(['BUY', 'SELL']),
        legs: z.array(legSchema).min(1).max(48),
        directionChanged: z.boolean(),
      })
      .strict()
      .nullable(),
    explanation: z.string().max(600),
    ownerNote: z.string().max(600).optional(),
  })
  .strict();
export const fitterReplySchema = z
  .object({
    decision: z.enum(['accept', 'revise', 'withdraw']),
    revisedAction: actionSchema.optional(),
    reason: z.string().max(600),
  })
  .strict()
  .superRefine((r, c) => {
    if ((r.decision === 'revise') !== (r.revisedAction !== undefined))
      c.addIssue({
        code: 'custom',
        message: 'revisedAction required only for revise',
      });
  });
export type Watch = z.infer<typeof watchSchema>;
export type WatchDraft = z.infer<typeof watchDraftSchema>;
export type Action = z.infer<typeof actionSchema>;
export type StrategistOutput = z.infer<typeof strategistSchema>;
export type FitterOutput = z.infer<typeof fitterSchema>;
export type Leg = z.infer<typeof legSchema>;
export type WatchChanges = z.infer<typeof watchChangesSchema>;
