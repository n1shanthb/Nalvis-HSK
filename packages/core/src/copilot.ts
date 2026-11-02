import { z } from 'zod';
import { verifyMessage, type Address, type Hex } from 'viem';
import { hash } from './canonical.js';

const address = z
  .string()
  .regex(/^0x[\da-f]{40}$/i)
  .transform((v) => v as Address);
const commitment = z
  .string()
  .regex(/^0x[\da-f]{64}$/i)
  .transform((v) => v as Hex);
const signature = z
  .string()
  .regex(/^0x[\da-f]{130}$/i)
  .transform((v) => v as Hex);
const uint = z.string().regex(/^\d+$/);
const second = z.number().int().nonnegative();
export const sellSessionSchema = z
  .object({
    version: z.literal(1),
    scope: z.enum(['SELL_WITHIN_MANDATE', 'TRADE_WITHIN_MANDATE']),
    chainId: z.union([z.literal(177), z.literal(133), z.literal(31337)]),
    owner: address,
    vault: address,
    sessionKey: address,
    policyHash: commitment,
    issuedAt: second,
    expiresAt: second,
    nonce: commitment,
  })
  .strict();
export const sellOrderSchema = z
  .object({
    version: z.literal(1),
    delegationHash: commitment,
    chainId: z.union([z.literal(177), z.literal(133), z.literal(31337)]),
    vault: address,
    policyHash: commitment,
    tokenIn: address,
    direction: z.enum(['BUY', 'SELL']).optional(),
    notionalB: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .refine((v) => Number(v) > 0 && Number.isFinite(Number(v))),
    amountIn: uint.refine((v) => BigInt(v) > 0n),
    minOut: uint.refine((v) => BigInt(v) > 0n),
    expectedOut: uint.refine((v) => BigInt(v) > 0n),
    nonce: uint,
    seq: uint,
    prevHead: commitment,
    stateHash: commitment,
    createdAt: second,
    validUntil: second,
  })
  .strict();
export const signedSellOrderSchema = z
  .object({
    delegation: sellSessionSchema,
    ownerSignature: signature,
    order: sellOrderSchema,
    orderSignature: signature,
  })
  .strict();
export type SellSession = z.infer<typeof sellSessionSchema>;
export type SellOrder = z.infer<typeof sellOrderSchema>;
export type SignedSellOrder = z.infer<typeof signedSellOrderSchema>;
export const sellSessionMessage = (s: SellSession) =>
  [
    `Nalvis Copilot: authorize a temporary ${s.scope === 'TRADE_WITHIN_MANDATE' ? 'trade' : 'sell'} session`,
    s.scope === 'TRADE_WITHIN_MANDATE'
      ? 'Scope: BUY or SELL within the existing mandate. No withdrawals or mandate changes.'
      : 'Scope: SELL only, within the existing mandate. No withdrawals or mandate changes.',
    `Owner: ${s.owner}`,
    `Vault: ${s.vault}`,
    `Chain: ${s.chainId}`,
    `Session key: ${s.sessionKey}`,
    `Policy: ${s.policyHash}`,
    `Issued: ${s.issuedAt}`,
    `Expires: ${s.expiresAt}`,
    `Nonce: ${s.nonce}`,
    'Every order requires an explicit Confirm in this browser. Closing it destroys the session key.',
  ].join('\n');
export const sellOrderId = (value: SignedSellOrder) =>
  hash({ delegation: value.delegation, order: value.order });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Both signatures must verify. Server/Redis access alone never authorizes a swap. */
export async function assertSellAuthorization(
  input: unknown,
  context: {
    owner: Address;
    vault: Address;
    chainId: number;
    policyHash: Hex;
    now: number;
  },
) {
  const signed = signedSellOrderSchema.parse(input),
    { delegation: d, order: o } = signed;
  if (
    !same(d.owner, context.owner) ||
    !same(d.vault, context.vault) ||
    !same(o.vault, context.vault) ||
    d.chainId !== context.chainId ||
    o.chainId !== context.chainId ||
    !same(d.policyHash, context.policyHash) ||
    !same(o.policyHash, context.policyHash)
  )
    throw Error('Owner, vault, network or mandate changed');
  if (
    d.issuedAt > context.now + 5 ||
    d.expiresAt <= context.now ||
    d.expiresAt - d.issuedAt > 900 ||
    d.expiresAt <= d.issuedAt ||
    o.createdAt < d.issuedAt - 5 ||
    o.createdAt > context.now + 5 ||
    o.validUntil <= context.now ||
    o.validUntil > d.expiresAt ||
    o.validUntil - o.createdAt > 90 ||
    o.validUntil <= o.createdAt ||
    o.delegationHash !== hash(d)
  )
    throw Error('Expired or invalid sell authorization');
  if (o.direction === 'BUY' && d.scope !== 'TRADE_WITHIN_MANDATE')
    throw Error('BUY requires an owner-authorized trade session');
  if (
    !(await verifyMessage({
      address: d.owner,
      message: sellSessionMessage(d),
      signature: signed.ownerSignature,
    })) ||
    !(await verifyMessage({
      address: d.sessionKey,
      message: { raw: hash(o) },
      signature: signed.orderSignature,
    }))
  )
    throw Error('Invalid owner/session signature');
  return signed;
}
