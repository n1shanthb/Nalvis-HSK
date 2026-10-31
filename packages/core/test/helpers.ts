import { readFileSync } from 'node:fs';
import {
  policySchema,
  policyHash,
  units,
  type Mandate,
} from '../src/policy.js';
import { inputFor } from '../src/engine-helpers.js';
import type { Evidence, EngineState } from '../src/types.js';
export function scenario(decimalsB = 6) {
  const policy = policySchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../../policy/default.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const now = 1800000000;
  const e: Evidence = {
    marketDataChainId: 177,
    executionChainId: decimalsB === 6 ? 31337 : 133,
    blockNumber: 1n,
    executionBlockNumber: 2n,
    now,
    decisionTime: now,
    validUntil: now + 120,
    riskInput: {sigma:0,observations:719,historyHash: '0x'+'a'.repeat(64)},
    decimalsA: 18,
    decimalsB,
    dexMid: 1,
    lastSwapAt: now,
    cex: [
      { venue: 'mexc', bid: 1.02, ask: 1.02, fetchedAt: now },
      { venue: 'gate', bid: 1.02, ask: 1.02, fetchedAt: now },
    ],
    apro: { price: 1.02, updatedAt: now, ageSec: 0 },
    quotes: [],
    sources: {
      fixture: {
        url: 'fixture:synthetic',
        method: 'synthetic',
        raw: 'clearly synthetic prices for unit tests',
        fetchedAt: now,
      },
    },
  };
  const state: EngineState = {
    preset: 'balanced',
    balanceA: units(100, 18),
    balanceB: units(900, decimalsB),
    lastTradeAt: 0,
    dailySpentB: 0n,
    dailyBucket: Math.floor(now / 86400),
    dailyLossB: 0,
    llmValid: true,
  };
  const mandate: Mandate = {
    expiry: now + 1000,
    revoked: false,
    maxTradeInA: units(1000, 18),
    maxTradeInB: units(100, decimalsB),
    maxDailyInB: units(1000, decimalsB),
    maxExposureBps: 10000,
    maxSlippageBps: 100,
    maxDrawdownBps: 2000,
    minIntervalSec: 0,
    policyHash: policyHash(policy),
  };
  for (const sizeB of policy.presets.balanced.sizeGridB)
    for (const direction of ['BUY_A', 'SELL_A'] as const)
      e.quotes.push({
        direction,
        sizeB,
        amountIn: inputFor(direction, sizeB, e),
        quotedOut: units(sizeB * 0.997, direction === 'BUY_A' ? 18 : decimalsB),
      });
  return { e, policy, state, mandate };
}
