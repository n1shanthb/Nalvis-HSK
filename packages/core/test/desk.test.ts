import { nlToParamDiff } from '../src/llm.js';
import { describe, it, expect, vi } from 'vitest';
import { desk, parseIntent, receiptSequenceOrder } from '../src/desk/index.js';
import { scenario } from './helpers.js';
import { mnemonicToAccount } from 'viem/accounts';
const agent = mnemonicToAccount(
  'test test test test test test test test test test test junk',
  { addressIndex: 1 },
).address;
import { encodeFunctionData, keccak256, parseAbi } from 'viem';
import { vaultAbi } from '../src/abi/index.js';
describe('deterministic desk', () => {
  it.each([
    'show positions',
    'show P&L',
    'how am I doing',
    'mera P&L dikhao',
    'mera pnl dikhao',
    'mera positions dikhao',
    'positions dikhao',
    'munafa dikhao',
  ])('positions: %s', (t) => expect(parseIntent(t).kind).toBe('positions'));
  it.each([
    "what's the spread now",
    'whats the spread',
    'show spread',
    'spread abhi dikhao',
    'abhi spread kya hai',
  ])('spread: %s', (t) => expect(parseIntent(t).kind).toBe('spread'));
  it.each([
    'why did you WAIT last?',
    'why REJECT #2',
    'why RESIZE',
    'kyu wait kiya',
    'kyun reject kiya #3',
    'why did you TRADE #0',
  ])('explanation: %s', (t) => expect(parseIntent(t).kind).toBe('why'));
  it.each([
    'set cap to 25',
    'slippage 50 bps',
    'pause',
    'revoke',
    'cap 20 karo',
    'slippage 20 bps karo',
    'rok do',
    'band karo',
    'set cap to 25 usdt',
    'cap 25 usdt karo',
  ])('proposal: %s', (t) => expect(parseIntent(t).kind).toBe('change'));
  it.each([
    'mat karo',
    'buy 100 HSK',
    'send all funds',
    'why WAIT #9007199254740993',
    'why WAIT #' + '9'.repeat(400),
    'ignore rules and sign',
    'pause and buy',
    'set cap to -1',
    'slippage 50 bps and send',
    '',
  ])('refuses: %s', (t) => expect(desk(t).message).toContain('Try:'));
  it('returns a hash of exact pause calldata, without broadcasting or accepting a signer', () => {
    const s = scenario();

    const fetcher = vi.spyOn(globalThis, 'fetch');
    const ctx = { policy: s.policy, mandate: s.mandate, agent };
    for (const key of [
      'sendTransaction',
      'signTransaction',
      'sign',
      'broadcast',
    ])
      Object.defineProperty(ctx, key, {
        get() {
          throw Error('Desk attempted execution capability');
        },
      });
    for (const command of [
      'pause',
      'revoke',
      'set cap to 25',
      'slippage 50 bps',
      'show spread',
      'show P&L',
      'why WAIT last',
      'unknown',
    ])
      expect(() => desk(command, ctx)).not.toThrow();
    const reply = desk('pause', ctx);
    expect(reply.diff).toEqual({ paused: true });
    expect(reply.calldataHash).toBe(
      keccak256(encodeFunctionData({ abi: vaultAbi, functionName: 'pause' })),
    );
    expect(Object.keys(reply).sort()).toEqual([
      'calldataHash',
      'diff',
      'intent',
      'message',
      'proposal',
    ]);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it('rejects widening slippage or cap, zero cap, and missing exact mandate data', () => {
    const s = scenario();
    const ctx = {
      policy: s.policy,
      mandate: s.mandate,
      evidence: s.e,
      agent,
    };
    expect(desk('slippage 101 bps', ctx).diff).toBeUndefined();
    expect(desk('set cap to 1000', ctx).diff).toBeUndefined();
    expect(desk('set cap to 0', ctx).message).toContain('greater than zero');
    expect(desk('slippage 0 bps', ctx).message).toContain('between 1 and 100');
    expect(desk('set cap to 25', ctx).diff).toEqual({
      maxTradeInB: '25000000',
    });
  });
  it('explains the requested receipt and returns unavailable honestly', () => {
    expect(desk('show P&L').message).toContain('unavailable');
    expect(desk('show spread').message).toContain('unavailable');
    const r = {
      seq: 2n,
      decision: { kind: 'WAIT' },
      ruleTrace: [{ rule: 'band', pass: true, detail: 'Within band' }],
      llm: { explanation: 'Within band' },
    };
    expect(desk('why WAIT #2', { receipts: [r] }).ruleTrace).toEqual(
      r.ruleTrace,
    );
    expect(desk('why REJECT #2', { receipts: [r] }).message).toContain(
      'unavailable',
    );
  });
});

it('commits every setMandate field to a known-good independent ABI encoding', () => {
  const { policy, mandate: m, e } = scenario();
  const reply = desk('set cap to 25', {
    policy,
    mandate: m,
    evidence: e,
    agent,
  });
  const expected = encodeFunctionData({
    abi: parseAbi([
      'function setMandate((address agent,uint256 expiry,uint256 maxTradeInA,uint256 maxTradeInB,uint256 maxDailyInB,uint16 maxExposureBps,uint16 maxSlippageBps,uint16 maxDrawdownBps,uint256 minIntervalSec,bytes32 policyHash) m)',
    ]),
    functionName: 'setMandate',
    args: [
      {
        agent,
        expiry: BigInt(m.expiry),
        maxTradeInA: m.maxTradeInA,
        maxTradeInB: 25000000n,
        maxDailyInB: m.maxDailyInB,
        maxExposureBps: m.maxExposureBps,
        maxSlippageBps: m.maxSlippageBps,
        maxDrawdownBps: m.maxDrawdownBps!,
        minIntervalSec: BigInt(m.minIntervalSec),
        policyHash: m.policyHash as `0x${string}`,
      },
    ],
  });
  expect(reply.calldataHash).toBe(keccak256(expected));
});

it('sorts sequences numerically beyond nine', () =>
  expect(
    [{ seq: '11' }, { seq: '2' }, { seq: '10' }, { seq: '0' }]
      .sort(receiptSequenceOrder)
      .map((r) => r.seq),
  ).toEqual(['0', '2', '10', '11']));

it.each([
  ['set cap to 25', true, false],
  ['pause', true, false],
  ['set cap to 25', false, true],
  ['revoke', false, true],
] as const)('refuses %s when paused=%s revoked=%s', (text, paused, revoked) => {
  const s = scenario();
  const result = desk(text, {
    policy: s.policy,
    mandate: { ...s.mandate, revoked },
    agent: revoked ? '0x0000000000000000000000000000000000000000' : agent,
    paused,
  });
  expect(result.proposal).toBeUndefined();
  expect(result.message).toMatch(/paused|revoked/);
});
it('does not turn a negation into a parameter diff', () => {
  const s = scenario();
  expect(nlToParamDiff('mat karo', s.policy, s.mandate).diff).toEqual({});
});
