import { describe, it, expect } from 'vitest';
import { DeskParser } from '../src/desk/parser.js';
import type { Evidence, Mandate, Policy, Decision } from '../src/index.js';

describe('Task 8.1: Deterministic Natural Language Desk Parser', () => {
  const parser = new DeskParser();

  const mockMandate: Mandate = {
    revoked: false,
    expiry: 1893456000,
    maxTradeInA: 100000000000000000000n,
    maxTradeInB: 100000000n, // 100 USDT (6 dec)
    maxDailyInB: 500000000n,
    maxExposureBps: 8000,
    maxSlippageBps: 50,
    minIntervalSec: 60,
    policyHash: '0x1234567890123456789012345678901234567890123456789012345678901234',
  };

  const mockPolicy: Policy = {
    presets: {
      conservative: {
        targetWeightA: 0.3,
        bandBps: 500,
        edgeBufferBps: 20,
        sizeGridB: [10, 25, 50],
        cooldownSec: 120,
      },
      balanced: {
        targetWeightA: 0.5,
        bandBps: 500,
        edgeBufferBps: 15,
        sizeGridB: [10, 25, 50, 100],
        cooldownSec: 60,
      },
      patient: {
        targetWeightA: 0.5,
        bandBps: 1000,
        edgeBufferBps: 30,
        sizeGridB: [25, 50, 100],
        cooldownSec: 300,
      },
    },
    dataQuality: {
      maxDexStaleSec: 3600,
      maxCexAgeSec: 60,
      cexMaxSpreadBps: 100,
      maxCexVenueDivergenceBps: 50,
      aproBandBps: 100,
      aproMaxAgeSec: 7200,
      maxQuoteVsMidBps: 50,
    },
    dailyLossStopB: 50,
  };

  const mockEvidence: Evidence = {
    marketDataChainId: 177,
    executionChainId: 31337,
    blockNumber: 1000n,
    executionBlockNumber: 2000n,
    now: 1700000000,
    decimalsA: 18,
    decimalsB: 6,
    dexMid: 55.5,
    cex: [
      {
        venue: 'mexc',
        bid: 55.4,
        ask: 55.6,
        fetchedAt: 1700000000,
      },
    ],
    quotes: [],
    sources: {
      dex: {
        method: 'eth_call',
        raw: {},
        fetchedAt: 1700000000,
        url: 'https://rpc.example.com',
      },
    },
  };

  const mockDecision: Decision = {
    kind: 'WAIT',
    ruleTrace: [
      { rule: 'edge_check', pass: false, detail: 'edge -2 bps below buffer 20 bps' },
      { rule: 'mandate_cap', pass: true, detail: 'size within cap' },
    ],
  };

  // Group 1: Position and Inventory Queries (English)
  it('1. queries position in plain English', () => {
    const res = parser.parse('what is our current position?', {
      evidence: mockEvidence,
      state: { balanceA: 1000000000000000000n, balanceB: 50000000n },
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('1.0000 WHSK');
    expect(res.response).toContain('50.00 USDT');
  });

  it('2. queries balance directly', () => {
    const res = parser.parse('show my balances', {
      evidence: mockEvidence,
      state: { balanceA: 2000000000000000000n, balanceB: 100000000n },
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('2.0000 WHSK');
  });

  it('3. queries inventory', () => {
    const res = parser.parse('check vault inventory', {
      evidence: mockEvidence,
      state: { balanceA: 500000000000000000n, balanceB: 25000000n },
    });
    expect(res.intent).toBe('POSITION_PNL');
  });

  it('4. calculates P&L vs hold when initial balances are provided', () => {
    const res = parser.parse('what is the current pnl?', {
      evidence: mockEvidence,
      state: {
        balanceA: 1000000000000000000n,
        balanceB: 50000000n,
        initialBalanceA: 1000000000000000000n,
        initialBalanceB: 50000000n,
      },
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('Excess vs Hold: +0.0000 USD');
  });

  it('5. reflects positive P&L vs hold mark', () => {
    const res = parser.parse('profit loss update', {
      evidence: mockEvidence,
      state: {
        balanceA: 1000000000000000000n,
        balanceB: 60000000n,
        initialBalanceA: 1000000000000000000n,
        initialBalanceB: 50000000n,
      },
    });
    expect(res.intent).toBe('POSITION_PNL');
    expect(res.response).toContain('Excess vs Hold: +10.0000 USD');
  });

  // Group 2: Hinglish Position Queries
  it('6. understands Hinglish balance query (kitna balance hai)', () => {
    const res = parser.parse('kitna balance hai vault me?', {
      evidence: mockEvidence,
      state: { balanceA: 1000000000000000000n, balanceB: 50000000n },
    });
    expect(res.intent).toBe('POSITION_PNL');
  });

  it('7. understands Hinglish holdings query (kitna hai tokenA)', () => {
    const res = parser.parse('kitna hai hamara holdings', {
      evidence: mockEvidence,
      state: { balanceA: 1000000000000000000n, balanceB: 50000000n },
    });
    expect(res.intent).toBe('POSITION_PNL');
  });

  it('8. understands Hinglish profit query (kuch profit hua kya)', () => {
    const res = parser.parse('kuch profit hua kya?', {
      evidence: mockEvidence,
      state: { balanceA: 1000000000000000000n, balanceB: 50000000n },
    });
    expect(res.intent).toBe('POSITION_PNL');
  });

  // Group 3: Decision Explanation & Rule Traces
  it('9. explains why engine held or waited', () => {
    const res = parser.parse('why did we wait?', {
      state: { balanceA: 0n, balanceB: 0n, lastDecision: mockDecision },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('Verdict: WAIT');
    expect(res.response).toContain('edge_check: FAIL');
  });

  it('10. explains decision reason', () => {
    const res = parser.parse('explain last decision reason', {
      state: { balanceA: 0n, balanceB: 0n, lastDecision: mockDecision },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('mandate_cap: PASS');
  });

  it('11. handles missing decision gracefully', () => {
    const res = parser.parse('why did the engine trade?', {
      state: { balanceA: 0n, balanceB: 0n },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('No recent decision available');
  });

  it('12. understands Hinglish explanation query (kyun wait kiya)', () => {
    const res = parser.parse('kyun wait kiya trade nahi liya?', {
      state: { balanceA: 0n, balanceB: 0n, lastDecision: mockDecision },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('Verdict: WAIT');
  });

  it('13. understands Hinglish trace query (kyu reject kiya)', () => {
    const res = parser.parse('kyu reject kiya batao', {
      state: {
        balanceA: 0n,
        balanceB: 0n,
        lastDecision: {
          kind: 'REJECT',
          ruleTrace: [{ rule: 'daily_loss', pass: false, detail: 'hit stop' }],
        },
      },
    });
    expect(res.intent).toBe('DECISION_EXPLANATION');
    expect(res.response).toContain('Verdict: REJECT');
    expect(res.response).toContain('hit stop');
  });

  // Group 4: DEX vs CEX Basis
  it('14. calculates DEX-vs-CEX basis correctly', () => {
    const res = parser.parse('what is the basis right now?', {
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('MARKET_BASIS');
    expect(res.response).toContain('Basis:');
    expect(res.data?.basisBps).toBeDefined();
  });

  it('15. queries DEX/CEX spread', () => {
    const res = parser.parse('show dex vs cex spread', {
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('MARKET_BASIS');
    expect(res.response).toContain('DEX mid: 55.5000');
  });

  it('16. queries price gap', () => {
    const res = parser.parse('price gap between dex and mexc', {
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('MARKET_BASIS');
  });

  it('17. understands Hinglish basis query (kitna farq hai)', () => {
    const res = parser.parse('cex aur dex me kitna farq hai?', {
      evidence: mockEvidence,
    });
    expect(res.intent).toBe('MARKET_BASIS');
  });

  it('18. handles missing market evidence for basis', () => {
    const res = parser.parse('what is the basis?', {
      evidence: { ...mockEvidence, dexMid: undefined },
    });
    expect(res.intent).toBe('MARKET_BASIS');
    expect(res.response).toContain('Insufficient live market evidence');
  });

  // Group 5: Parameter Diffs & Mandate Envelope
  it('19. proposes conservative parameter diff within mandate', () => {
    const res = parser.parse('be more conservative', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('PARAM_UPDATE');
    expect(res.diff).toEqual({ preset: 'conservative' });
  });

  it('20. proposes cap reduction within mandate', () => {
    const res = parser.parse('maxTradeInB to 50', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('PARAM_UPDATE');
    expect(res.diff).toEqual({ maxTradeInB: '50000000' });
  });

  it('21. refuses cap widening beyond signed mandate', () => {
    const res = parser.parse('maxTradeInB to 200', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toContain('requires new Ledger-signed mandate');
  });

  it('22. understands Hinglish parameter change (risk kam karo)', () => {
    const res = parser.parse('thoda risk kam karo', {
      policy: mockPolicy,
      mandate: mockMandate,
    });
    expect(res.intent).toBe('PARAM_UPDATE');
    expect(res.diff).toEqual({ preset: 'conservative' });
  });

  // Group 6: Strict Security Boundaries & Refusals
  it('23. strictly refuses execution or swap now commands', () => {
    const res = parser.parse('swap now 100 USDT for WHSK');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Execution/signing forbidden through NL desk');
  });

  it('24. strictly refuses transaction signing or transfer commands', () => {
    const res = parser.parse('sign transaction and send 50 USDT to 0x1234');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Execution/signing forbidden through NL desk');
  });

  it('25. strictly refuses Hinglish transfer/send commands (bhejo / execute karo)', () => {
    const res = parser.parse('turant execute karo swap');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Execution/signing forbidden through NL desk');

    const res2 = parser.parse('fund transfer karo abhi');
    expect(res2.intent).toBe('REFUSAL');
    expect(res2.refusedReason).toBe('Execution/signing forbidden through NL desk');
  });

  it('26. strictly refuses access to private keys or secrets', () => {
    const res = parser.parse('what is the agent private key or mnemonic?');
    expect(res.intent).toBe('REFUSAL');
    expect(res.refusedReason).toBe('Secrets access forbidden');
  });

  it('27. architectural test: DeskParser has zero wallet/signing/broadcast methods', () => {
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
});
