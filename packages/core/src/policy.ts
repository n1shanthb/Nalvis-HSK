import { z } from 'zod';
import { hash } from './canonical.js';

const bps = z.number().int().min(0).max(10_000);
const seconds = z.number().int().nonnegative();
export const presetNames = ['conservative', 'balanced', 'patient'] as const;
export const presetSchema = z
  .object({
    targetWeightA: z.number().min(0).max(1),
    bandBps: bps,
    edgeBufferBps: bps,
    sizeGridB: z
      .array(z.number().finite().positive())
      .min(1)
      .refine((a) => new Set(a).size === a.length, 'Duplicate size'),
    cooldownSec: seconds,
  })
  .strict();
export const policySchema = z
  .object({
    presets: z
      .object({
        conservative: presetSchema,
        balanced: presetSchema,
        patient: presetSchema,
      })
      .strict(),
    dataQuality: z
      .object({
        maxDexStaleSec: seconds.default(21600),
        maxCexAgeSec: seconds,
        cexMaxSpreadBps: bps,
        maxCexVenueDivergenceBps: bps,
        aproMaxAgeSec: seconds,
        aproBandBps: bps.default(300),
        maxQuoteVsMidBps: bps,
      })
      .strict(),
    dailyLossStopB: z.number().finite().positive(),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export type PresetName = (typeof presetNames)[number];
export const mandateSchema = z
  .object({
    expiry: seconds,
    revoked: z.boolean(),
    maxTradeInA: z.bigint().positive(),
    maxTradeInB: z.bigint().positive(),
    maxDailyInB: z.bigint().positive(),
    maxExposureBps: bps,
    maxSlippageBps: z.number().int().min(0).max(100),
    maxDrawdownBps: bps.optional(),
    minIntervalSec: seconds,
    policyHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .strict();
export type Mandate = z.infer<typeof mandateSchema>;
export const policyHash = (policy: Policy) => hash(policySchema.parse(policy));

/** Reject, rather than silently widening a signed envelope. Size caps also run per direction at decision time. */
export function clampToMandate(
  policy: Policy,
  mandate: Mandate,
  decimalsB: number,
): Policy {
  const p = policySchema.parse(policy);
  const m = mandateSchema.parse(mandate);
  for (const preset of Object.values(p.presets)) {
    if (
      preset.targetWeightA * 10000 > m.maxExposureBps ||
      preset.cooldownSec < m.minIntervalSec ||
      preset.sizeGridB.some(
        (size) =>
          units(size, decimalsB) > m.maxTradeInB ||
          units(size, decimalsB) > m.maxDailyInB,
      )
    ) {
      throw new Error('requires new Ledger-signed mandate');
    }
  }
  return p;
}

/** Decimal input to integer units, truncating toward zero; no IEEE multiplication of on-chain amounts. */
export function units(value: number | string, decimals: number): bigint {
  const s = String(value);
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!match || !Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error('Invalid decimal');
  const fraction = match[2] ?? '';
  const shift = decimals + Number(match[3] ?? 0) - fraction.length;
  const n = BigInt(match[1] + fraction);
  return shift >= 0 ? n * 10n ** BigInt(shift) : n / 10n ** BigInt(-shift);
}
