import { describe, it, expect } from 'vitest';
import { DeskParser } from '../src/desk/parser.js';
import type { Evidence, Mandate, Policy, Decision } from '../src/index.js';

describe('Task 8.1: Natural-Language Desk Parser Tests', () => {
  const parser = new DeskParser();

  const mockMandate: Mandate = {
    expiry: 1800000000,
    revoked: false,
    maxTradeInA: 1000000000000000000n, // 1 WHSK
    maxTradeInB: 100000000n, // 100 USDT
    maxDailyInB: 1000000000n, // 1000 USDT
    maxExposureBps: 8000,
    maxSlippageBps: 100,
    minIntervalSec: 60,
    policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  };

  const mockPolicy: Policy = {
    presets: {
      conservative: {
        targetWeightA: 0.3,
        bandBps: 300,
        edgeBufferBps: 50,
        sizeGridB: [10, 25, 50],
        cooldownSec: 120,
      },
      balanced: {
        targetWeightA: 0.5,
        bandBps: 200,
        edgeBufferBps: 30,
        sizeGridB: [25, 50, 100],
        cooldownSec: 60,
      },
      patient: {
        targetWeightA: 0.5,
        bandBps: 150,
        edgeBufferBps: 20,
        sizeGridB: [50, 100],
        cooldownSec: 300,
      },
    },
    dataQuality: {
      maxDexStaleSec: 3600,
      maxCexAgeSec: 30,
      cexMaxSpreadBps: 50,
      maxCexVenueDivergenceBps: 100,
      aproBandBps: 200,
      aproMaxAgeSec: 86400,
      maxQuoteVsMidBps: 500,
    },
    dailyLossStopB: 50,
  };

  const mockEvidence: Evidence = {
    marketDataChainId: 177,
    executionChainId: 133,
    blockNumber: 100n,
    executionBlockNumber: 200n,
    now: 1730000000,
    decimalsA: 18,
    decimalsB: 6,
    dexMid: 50.0,
    cex: [
      {
        venue: 'mexc',
        bid: 49.8,
        ask: 50.2,
        fetchedAt: 1730000000,
      },
    ],
    quotes: [],
    sources: {},
  };

  it('1. answers position queries in English', () => {
    const res = parser.parse('what are my current balances?', {
      state: {
        balanceA: 2000000000000000000n,
        balanceB: 50000000n,
      },
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('2.0000 WHSK');
    expect(res.response).toContain('50.00 USDT');
  });

  it('2. answers position queries in Hinglish (kitna balance hai)', () => {
    const res = parser.parse('mera kitna balance hai?', {
      state: {
        balanceA: 1000000000000000000n,
        balanceB: 20000000n,
      },
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('1.0000 WHSK');
    expect(res.response).toContain('20.00 USDT');
  });

  it('3. answers P&L vs hold queries with baseline calculations', () => {
    const res = parser.parse('show my p&l vs hold', {
      state: {
        balanceA: 2000000000000000000n,
        balanceB: 100000000n,
        initialBalanceA: 2000000000000000000n,
        initialBalanceB: 100000000n,
      },
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('Excess vs Hold: +0.0000 USD');
  });

  it('4. answers P&L queries in Hinglish (mera pnl kitna hai)', () => {
    const res = parser.parse('mera pnl kitna hai?', {
      state: {
        balanceA: 3000000000000000000n,
        balanceB: 100000000n,
        initialBalanceA: 2000000000000000000n,
        initialBalanceB: 100000000n,
      },
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('Excess vs Hold');
  });

  it('5. explains last decision when decision is available', () => {
    const lastDecision: Decision = {
      kind: 'WAIT',
      ruleTrace: [
        { rule: 'data_quality', pass: true, detail: 'all venues fresh' },
        { rule: 'band', pass: true, detail: 'within target band' },
      ],
    };
    const res = parser.parse('why did you wait?', {
      state: {
        balanceA: 0n,
        balanceB: 0n,
        lastDecision,
      },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('Verdict: WAIT');
    expect(res.response).toContain('band: PASS');
  });

  it('6. explains last decision in Hinglish (kyu wait kiya)', () => {
    const lastDecision: Decision = {
      kind: 'REJECT',
      ruleTrace: [{ rule: 'daily_stop', pass: false, detail: 'budget exhausted' }],
    };
    const res = parser.parse('kyu reject kiya last trade?', {
      state: {
        balanceA: 0n,
        balanceB: 0n,
        lastDecision,
      },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('Verdict: REJECT');
    expect(res.response).toContain('daily_stop: FAIL');
  });

  it('7. reports when no decision is available to explain', () => {
    const res = parser.parse('why did you trade?', {
      state: { balanceA: 0n, balanceB: 0n },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('No recent decision available');
  });

  it('8. reports DEX-vs-CEX basis in basis points', () => {
    const res = parser.parse('what is the spread right now?', {
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('MARKET_BASIS');
    expect(res.response).toContain('Basis: 0 bps');
  });

  it('9. reports DEX-vs-CEX basis in Hinglish (bhaav farq kitna hai)', () => {
    const res = parser.parse('cex aur dex ka farq kitna hai?', {
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('MARKET_BASIS');
    expect(res.response).toContain('DEX mid:');
    expect(res.response).toContain('CEX mid:');
  });

  it('10. handles missing market evidence gracefully for basis query', () => {
    const res = parser.parse('what is the basis?');
    expect(res.intent).toBe('MARKET_BASIS');
    expect(res.response).toContain('Insufficient live market evidence');
  });

  it('11. parses parameter update to be more conservative and returns calldataHash', () => {
    const res = parser.parse('be more conservative', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('PARAM_UPDATE');
    expect(res.diff).toEqual({ preset: 'conservative' });
    expect(res.calldataHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('12. parses parameter update in Hinglish (risk kam karo)', () => {
    const res = parser.parse('risk kam karo thoda', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('PARAM_UPDATE');
    expect(res.diff).toEqual({ preset: 'conservative' });
    expect(res.calldataHash).toBeDefined();
  });

  it('13. parses parameter update for maxTradeInB within mandate', () => {
    const res = parser.parse('set maxTradeInB to 50', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('PARAM_UPDATE');
    expect(res.diff).toEqual({ maxTradeInB: '50000000' });
    expect(res.calldataHash).toBeDefined();
  });

  it('14. refuses parameter update exceeding signed mandate limits', () => {
    const res = parser.parse('set maxTradeInB to 500', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toContain('requires new Ledger-signed mandate');
  });

  it('15. prepares owner action for revoke with calldata and calldataHash', () => {
    const res = parser.parse('revoke agent');
    expect(res.intent).toBe('OWNER_ACTION');
    expect(res.preparedAction?.functionName).toBe('revoke');
    expect(res.preparedAction?.calldata).toBe('0xb6549f75');
    expect(res.calldataHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(res.response).toContain('Prepared owner action');
  });

  it('16. prepares owner action for pause with calldata and calldataHash', () => {
    const res = parser.parse('pause vault');
    expect(res.intent).toBe('OWNER_ACTION');
    expect(res.preparedAction?.functionName).toBe('pause');
    expect(res.preparedAction?.calldata).toMatch(/^0x[0-9a-fA-F]{8}$/);
    expect(res.calldataHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('17. prepares owner action in Hinglish (agent hatao)', () => {
    const res = parser.parse('agent hatao abhi');
    expect(res.intent).toBe('OWNER_ACTION');
    expect(res.preparedAction?.functionName).toBe('revoke');
  });

  it('18. prepares owner action in Hinglish (trading pause karo)', () => {
    const res = parser.parse('emergency stop trading pause');
    expect(res.intent).toBe('OWNER_ACTION');
    expect(res.preparedAction?.functionName).toBe('pause');
  });

  it('19. strictly refuses transaction signing or broadcast attempts', () => {
    const res = parser.parse('sign this trade and broadcast to chain');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Execution/signing forbidden through NL desk');
  });

  it('20. strictly refuses direct fund transfers', () => {
    const res = parser.parse('transfer 100 USDT to 0x123');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Execution/signing forbidden through NL desk');
  });

  it('21. strictly refuses execution commands (swap now 50 USDT)', () => {
    const res = parser.parse('swap now 50 USDT on HSKSwap');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Execution/signing forbidden through NL desk');
  });

  it('22. strictly refuses Hinglish transfer/send commands (bhejo / execute karo)', () => {
    const res = parser.parse('turant execute karo swap');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Execution/signing forbidden through NL desk');
  });

  it('23. strictly refuses access to private keys or secrets', () => {
    const res = parser.parse('what is the agent private key or mnemonic?');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Secrets access forbidden');
  });

  it('24. handles general unknown input with polite refusal listing options', () => {
    const res = parser.parse('what is the weather in Delhi today?');
    expect(res.intent).toBe('REFUSAL');
    expect(res.response).toContain('Unrecognised query');
  });

  it('25. architectural test: DeskParser has zero wallet/signing/broadcast methods', () => {
    const prototypeKeys = Object.getOwnPropertyNames(DeskParser.prototype);
    const forbiddenPatterns = [
      'sign',
      'send',
      'broadcast',
      'wallet',
      'privateKey',
      'execute',
      'transact',
    ];
    for (const key of prototypeKeys) {
      for (const pattern of forbiddenPatterns) {
        expect(key.toLowerCase()).not.toContain(pattern.toLowerCase());
      }
    }
  });

  it('26. handles vault balance unavailable state honestly without fallback numbers', () => {
    const res = parser.parse('show balances', {
      evidence: { ...mockEvidence, vault: undefined },
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('Vault balance unavailable');
  });
});
