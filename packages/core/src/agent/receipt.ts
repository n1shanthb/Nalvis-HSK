import { z } from 'zod';
import { hash } from '../canonical.js';
import { actionSchema, legSchema } from './schema.js';
export const hexSchema = z
  .string()
  .regex(/^0x[\da-fA-F]{64}$/)
  .transform((v) => v as `0x${string}`);
const uint = z
  .union([z.bigint(), z.string().regex(/^\d+$/).transform(BigInt)])
  .pipe(z.bigint().nonnegative());
const seconds = z.number().int().nonnegative();
export const receiptV3Schema = z
  .object({
    version: z.literal(3),
    marketDataChainId: z.literal(177),
    executionChainId: z.union([z.literal(133), z.literal(31337)]),
    contract: z.string().regex(/^0x[\da-fA-F]{40}$/).transform(v=>v as `0x${string}`),
    seq: uint,
    prevHead: hexSchema,
    policyHash: hexSchema,
    evidenceHash: hexSchema,
    strategy: z
      .object({
        mode: z.enum(['agent', 'rules-demo']),
        provider: z.string(),
        models: z
          .object({ strategist: z.string(), fitter: z.string() })
          .strict(),
        promptVersions: z.array(z.string()),
        strategyHash: hexSchema,
      })
      .strict(),
    intent: actionSchema,
    fit: z
      .object({
        rounds: seconds,
        trail: z.string(),
        legs: z.array(legSchema),
        acceptedDirectionChange: z.boolean(),
      })
      .strict(),
    final: z
      .object({
        kind: z.enum(['TRADE', 'RESIZE', 'WAIT', 'REJECT']),
        direction: z.enum(['BUY', 'SELL', 'HOLD']),
        tokenIn: z.string().regex(/^0x[\da-fA-F]{40}$/).transform(v=>v as `0x${string}`),
        amountIn: uint,
        minOut: uint,
        validUntil: seconds,
        deadline: seconds,
        nonce: uint,
        prevHead: hexSchema,
      })
      .strict(),
    mandateCheck: z
      .object({ stateBlock: uint, stateHash: hexSchema, ok: z.boolean() })
      .strict(),
    journalHead: hexSchema,
    journalFrom: hexSchema,
    simulation: z
      .object({ ok: z.boolean(), block: uint, error: z.string().optional() })
      .strict(),
    receiptHash: hexSchema,
    settlement: z.object({ transactionHash: hexSchema }).strict().optional(),
  })
  .strict();
export type ReceiptV3 = z.infer<typeof receiptV3Schema>;
export type ReceiptV3Body = Omit<ReceiptV3, 'receiptHash' | 'settlement'>;
/** v3 commits every body field. Only receiptHash and post-mine settlement are excluded. */
export function receiptHashV3(receipt: ReceiptV3Body | ReceiptV3) {
  const {
    receiptHash: _hash,
    settlement: _settlement,
    ...body
  } = receipt as ReceiptV3;
  void _hash;
  void _settlement;
  return hash(body);
}
export function buildReceiptV3(body: ReceiptV3Body): ReceiptV3 {
  const r = receiptV3Schema.parse({
    ...body,
    receiptHash: receiptHashV3(body),
  });
  return r;
}
