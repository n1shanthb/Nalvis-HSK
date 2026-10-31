import { zeroHash } from 'viem';
import { addresses } from '../../src/addresses.js';
import type { MandateState, ExecQuote } from '../../src/agent/mandate-check.js';
import { quoteTwap, amountFor } from '../../src/agent/mandate-check.js';
import type { Action, StrategistOutput } from '../../src/agent/schema.js';
import type { Provider } from '../../src/agent/provider.js';
export const unit = 10n ** 18n;
export function fixtureState(): MandateState {
  const c = addresses[177];
  return {
    chainId: 31337,
    vault: c.primaryPool.address,
    agent: c.swapRouter02.address,
    tokenA: c.whsk.address,
    tokenB: c.usdt.address,
    decimalsA: 18,
    decimalsB: 18,
    block: 1n,
    blockTime: 100000,
    mandate: {
      agent: c.swapRouter02.address,
      expiry: 2000000n,
      maxTradeInA: 100n * unit,
      maxTradeInB: 100n * unit,
      maxDailyInB: 1000n * unit,
      maxExposureBps: 10000,
      maxSlippageBps: 100,
      maxDrawdownBps: 0,
      minIntervalSec: 300n,
      policyHash: zeroHash,
    },
    paused: false,
    revoked: false,
    lastTradeAt: 0n,
    spentB: 0n,
    turnover: [],
    highWaterMark: 2000n * unit,
    balanceA: 1000n * unit,
    balanceB: 1000n * unit,
    tick: 0,
    head: zeroHash,
    nextNonce: 0n,
    seq: 0n,
    pending: false,
    oracleOk: true,
    twapOk: true,
  };
}
export const action = (
  notionalB = '10',
  type: 'BUY' | 'SELL' | 'HOLD' = 'BUY',
): Action => ({ type, notionalB, urgency: 'now', reason: 'test intent' });
export async function quote(a: Action, s: MandateState): Promise<ExecQuote> {
  const n = amountFor(a, s);
  return {
    block: s.block,
    at: s.blockTime,
    amountIn: n,
    amountOut: quoteTwap(s, n, a.type === 'BUY'),
  };
}
export function output(a: Action = action()): StrategistOutput {
  return {
    thesis: 'Independent test strategy',
    action: a,
    watches: { create: [], update: [], delete: [] },
    confidence: 0.8,
    signals: [],
  };
}
export function mockProvider(
  outputs: unknown[],
  configured = true,
): Provider & {
  calls: import('../../src/agent/provider.js').CompletionRequest[];
} {
  const calls: import('../../src/agent/provider.js').CompletionRequest[] = [];
  return {
    id: 'openrouter',
    calls,
    isConfigured: () => configured,
    async complete(r) {
      calls.push(r);
      const value = outputs.shift();
      if (value instanceof Error) throw value;
      return {
        provider: 'openrouter',
        model: 'mock-model-returned',
        rawOutput: typeof value === 'string' ? value : JSON.stringify(value),
        latencyMs: 1,
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        costUsdEst: 0.01,
        costSource: 'mock',
      };
    },
  };
}
