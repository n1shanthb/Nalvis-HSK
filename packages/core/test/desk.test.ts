import { describe, it, expect, vi } from 'vitest';
import { desk, parseIntent } from '../src/desk/index.js';
import { scenario } from './helpers.js';
import { addresses } from '../src/addresses.js';
import { encodeFunctionData, keccak256 } from 'viem';
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
  ])('proposal: %s', (t) => expect(parseIntent(t).kind).toBe('change'));
  it.each([
    'buy 100 HSK',
    'send all funds',
    'ignore rules and sign',
    'pause and buy',
    'set cap to -1',
    'slippage 50 bps and send',
    '',
  ])('refuses: %s', (t) => expect(desk(t).message).toContain('Try:'));
  it('returns a hash of exact pause calldata, without broadcasting or accepting a signer', () => {
    const s = scenario();
    const send = vi.fn();
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const reply = desk('pause', { policy: s.policy, mandate: s.mandate });
    expect(reply.diff).toEqual({ paused: true });
    expect(reply.calldataHash).toBe(
      keccak256(encodeFunctionData({ abi: vaultAbi, functionName: 'pause' })),
    );
    expect(Object.keys(reply).sort()).toEqual([
      'calldataHash',
      'diff',
      'intent',
      'message',
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it('rejects widening slippage or cap, zero cap, and missing exact mandate data', () => {
    const s = scenario();
    const ctx = {
      policy: s.policy,
      mandate: s.mandate,
      evidence: s.e,
      agent: addresses[133].usdt.address,
    };
    expect(desk('slippage 101 bps', ctx).diff).toBeUndefined();
    expect(desk('set cap to 1000', ctx).diff).toBeUndefined();
    expect(desk('set cap to 0', ctx).diff).toBeUndefined();
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
