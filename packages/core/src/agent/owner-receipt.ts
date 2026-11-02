import { z } from 'zod';
import { hash } from '../canonical.js';
import { signedSellOrderSchema } from '../copilot.js';
import { receiptV3Schema } from './receipt.js';
import { mandateStateSchema } from './mandate-check.js';
const uint = z.union([z.bigint(), z.string().regex(/^\d+$/).transform(BigInt)]);
/** v4 is owner-directed execution, never represented as an autonomous model decision. */
export const ownerReceiptSchema = receiptV3Schema
  .extend({
    version: z.literal(4),
    authorization: signedSellOrderSchema,
    owner: z.string().regex(/^0x[\da-f]{40}$/i),
    state: mandateStateSchema,
    quote: z
      .object({
        block: uint,
        at: z.number().int(),
        amountIn: uint,
        amountOut: uint,
      })
      .strict(),
    strategy: z
      .object({
        mode: z.literal('owner-command'),
        provider: z.literal('owner-session'),
        models: z
          .object({ strategist: z.literal('none'), fitter: z.literal('none') })
          .strict(),
        promptVersions: z.array(z.string()).length(0),
        strategyHash: z.string().regex(/^0x[\da-f]{64}$/i),
      })
      .strict(),
  })
  .strict();
export type OwnerReceipt = z.infer<typeof ownerReceiptSchema>;
export const executionReceiptSchema = z.union([
  receiptV3Schema,
  ownerReceiptSchema,
]);
export function ownerReceiptHash(
  receipt: Omit<OwnerReceipt, 'receiptHash' | 'settlement'> | OwnerReceipt,
) {
  const {
    receiptHash: _hash,
    settlement: _settlement,
    ...body
  } = receipt as OwnerReceipt;
  void _hash;
  void _settlement;
  return hash(body);
}
