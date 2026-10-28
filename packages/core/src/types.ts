import { z } from 'zod';
import { mandateSchema } from './policy.js';
const positive = z.number().finite().positive();
const time = z.number().int().nonnegative();
export const directionSchema = z.enum(['BUY_A', 'SELL_A']);
export type Direction = z.infer<typeof directionSchema>;
export const sourceSchema = z
  .object({
    address: z.string().optional(),
    url: z.string().optional(),
    method: z.string(),
    raw: z.unknown(),
    fetchedAt: time,
    error: z.string().optional(),
    chainId: z.number().int().optional(),
    blockNumber: z.bigint().optional(),
  })
  .strict()
  .refine((s) => s.address !== undefined || s.url !== undefined);
export const quoteSchema = z
  .object({
    direction: directionSchema,
    sizeB: positive,
    amountIn: z.bigint().positive(),
    quotedOut: z.bigint().positive(),
    twapFloor: z.bigint().nonnegative().optional(),
  })
  .strict();
export type Quote = z.infer<typeof quoteSchema>;
export const evidenceSchema = z
  .object({
    marketDataChainId: z.literal(177),
    executionChainId: z.union([z.literal(133), z.literal(31337)]),
    blockNumber: z.bigint().nonnegative(),
    executionBlockNumber: z.bigint().nonnegative(),
    now: time,
    decimalsA: z.number().int().min(0).max(36),
    decimalsB: z.number().int().min(0).max(36),
    dexMid: positive.optional(),
    lastSwapAt: time.optional(),
    cex: z.array(
      z
        .object({
          venue: z.enum(['mexc', 'gate']),
          bid: positive,
          ask: positive,
          fetchedAt: time,
        })
        .strict(),
    ),
    apro: z
      .object({ price: positive, updatedAt: time, ageSec: z.number().int() })
      .strict()
      .optional(),
    quotes: z.array(quoteSchema),
    sources: z.record(sourceSchema),
    vault: z
      .object({
        decimalsA: z.number().int().min(0).max(36),
        decimalsB: z.number().int().min(0).max(36),
        balanceA: z.bigint().nonnegative(),
        balanceB: z.bigint().nonnegative(),
        mandate: mandateSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type RuleTrace = { rule: string; pass: boolean; detail: string }[];
export type Decision = {
  kind: 'TRADE' | 'RESIZE' | 'WAIT' | 'REJECT';
  direction?: Direction;
  sizeB?: number;
  amountIn?: bigint;
  minOut?: bigint;
  ruleTrace: RuleTrace;
};
export const engineStateSchema = z
  .object({
    preset: z.enum(['conservative', 'balanced', 'patient']),
    balanceA: z.bigint().nonnegative(),
    balanceB: z.bigint().nonnegative(),
    lastTradeAt: time,
    dailySpentB: z.bigint().nonnegative(),
    dailyBucket: time,
    dailyLossB: z.number().finite().nonnegative(),
    llmValid: z.boolean(),
  })
  .strict();
export type EngineState = z.infer<typeof engineStateSchema>;
