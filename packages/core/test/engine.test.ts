import { describe, it, expect } from 'vitest';
import { scenario } from './helpers.js';
import { decide } from '../src/engine.js';
import { units, policyHash } from '../src/policy.js';

type Case = {
  name: string;
  change: (s: ReturnType<typeof scenario>) => void;
  kind: string;
  rule?: string;
};
const cases: Case[] = [
  {
    name: 'bad state schema',
    change: (s) => {
      s.state.balanceA = -1n;
    },
    kind: 'REJECT',
    rule: 'schema',
  },
  { name: 'largest valid', change: () => {}, kind: 'TRADE' },
  {
    name: 'cap resize',
    change: (s) => {
      s.mandate.maxTradeInB = units(50, 6);
    },
    kind: 'RESIZE',
  },
  {
    name: 'cost curve resize',
    change: (s) => {
      s.e.quotes.find(
        (q) => q.direction === 'BUY_A' && q.sizeB === 100,
      )!.quotedOut = units(98, 18);
    },
    kind: 'RESIZE',
  },
  {
    name: 'in band',
    change: (s) => {
      s.state.balanceA = units(900, 18);
    },
    kind: 'WAIT',
    rule: 'band',
  },
  {
    name: 'buy basis wrong side',
    change: (s) => {
      s.e.cex.forEach((c) => {
        c.bid = 0.99;
        c.ask = 0.99;
      });
    },
    kind: 'WAIT',
    rule: 'basis',
  },
  {
    name: 'sell basis wrong side',
    change: (s) => {
      s.state.balanceA = units(2000, 18);
    },
    kind: 'WAIT',
    rule: 'basis',
  },
  {
    name: 'sell trade',
    change: (s) => {
      s.state.balanceA = units(2000, 18);
      s.e.cex.forEach((c) => {
        c.bid = 0.98;
        c.ask = 0.98;
      });
      s.e.apro!.price = 0.98;
    },
    kind: 'TRADE',
  },
  {
    name: 'edge zero',
    change: (s) => {
      s.policy.presets.balanced.edgeBufferBps = 500;
      s.mandate.policyHash = policyHash(s.policy);
    },
    kind: 'WAIT',
    rule: 'edge_or_caps',
  },
  {
    name: 'all capped',
    change: (s) => {
      s.mandate.maxTradeInB = 1n;
    },
    kind: 'WAIT',
  },
  {
    name: 'stale dex',
    change: (s) => {
      s.e.lastSwapAt! -= 21601;
    },
    kind: 'REJECT',
    rule: 'data_quality',
  },
  {
    name: 'cex missing',
    change: (s) => {
      s.e.cex = [];
    },
    kind: 'REJECT',
  },
  {
    name: 'cex divergence',
    change: (s) => {
      s.e.cex[1].bid = 1.1;
      s.e.cex[1].ask = 1.1;
    },
    kind: 'REJECT',
  },
  {
    name: 'cex spread',
    change: (s) => {
      s.e.cex[0].ask = 2;
    },
    kind: 'REJECT',
  },
  {
    name: 'fresh APRO off band',
    change: (s) => {
      s.e.apro!.price = 2;
    },
    kind: 'REJECT',
    rule: 'apro_band',
  },
  {
    name: 'stale APRO ignored',
    change: (s) => {
      s.e.apro = { price: 2, updatedAt: s.e.now - 72000, ageSec: 72000 };
    },
    kind: 'TRADE',
    rule: 'apro_stale_ignored',
  },
  {
    name: 'expired',
    change: (s) => {
      s.mandate.expiry = s.e.now;
    },
    kind: 'REJECT',
    rule: 'mandate_expired',
  },
  {
    name: 'revoked',
    change: (s) => {
      s.mandate.revoked = true;
    },
    kind: 'REJECT',
    rule: 'mandate_revoked',
  },
  {
    name: 'daily exhausted',
    change: (s) => {
      s.state.dailySpentB = s.mandate.maxDailyInB;
    },
    kind: 'REJECT',
    rule: 'daily_stop',
  },
  {
    name: 'daily loss stop',
    change: (s) => {
      s.state.dailyLossB = 25;
    },
    kind: 'REJECT',
    rule: 'daily_stop',
  },
  {
    name: 'UTC loss reset does not reset rolling turnover',
    change: (s) => {
      s.state.dailyLossB = 25;
      s.state.dailySpentB = s.mandate.maxDailyInB;
      s.state.dailyBucket--;
    },
    kind: 'REJECT',
    rule: 'daily_stop',
  },
  {
    name: 'UTC daily loss reset',
    change: (s) => {
      s.state.dailyLossB = 25;
      s.state.dailyBucket--;
    },
    kind: 'TRADE',
  },
  {
    name: 'invalid LLM',
    change: (s) => {
      s.state.llmValid = false;
    },
    kind: 'REJECT',
    rule: 'llm_invalid',
  },
  {
    name: 'cooldown',
    change: (s) => {
      s.state.lastTradeAt = s.e.now;
    },
    kind: 'WAIT',
    rule: 'cooldown',
  },
  {
    name: 'empty balances',
    change: (s) => {
      s.state.balanceA = 0n;
      s.state.balanceB = 0n;
    },
    kind: 'REJECT',
    rule: 'balances',
  },
  {
    name: 'quote missing',
    change: (s) => {
      s.e.quotes = [];
    },
    kind: 'REJECT',
    rule: 'quote_missing',
  },
  {
    name: 'hash mismatch',
    change: (s) => {
      s.policy.dailyLossStopB++;
    },
    kind: 'REJECT',
    rule: 'policy_hash',
  },
  {
    name: 'bad evidence schema',
    change: (s) => {
      s.e.dexMid = NaN;
    },
    kind: 'REJECT',
    rule: 'schema',
  },
  {
    name: 'bad policy schema',
    change: (s) => {
      s.policy.dailyLossStopB = -1;
    },
    kind: 'REJECT',
    rule: 'schema',
  },
  {
    name: 'bad mandate schema',
    change: (s) => {
      s.mandate.maxTradeInA = -1n;
    },
    kind: 'REJECT',
    rule: 'schema',
  },
  {
    name: 'source failure',
    change: (s) => {
      s.e.sources.fixture.error = 'offline';
    },
    kind: 'REJECT',
  },
  {
    name: 'TWAP floor raised',
    change: (s) => {
      s.e.quotes.forEach((q) => {
        q.twapFloor = q.quotedOut;
      });
    },
    kind: 'TRADE',
  },
  {
    name: 'TWAP floor exceeds quote',
    change: (s) => {
      s.e.quotes.forEach((q) => {
        q.twapFloor = q.quotedOut + 1n;
      });
    },
    kind: 'WAIT',
  },
];
describe('all engine decisions', () => {
  it.each(cases)('$name', ({ change, kind, rule }) => {
    const s = scenario();
    change(s);
    const d = decide(s.e, s.policy, s.mandate, s.state);
    expect(d.kind).toBe(kind);
    if (rule) expect(d.ruleTrace.some((t) => t.rule === rule)).toBe(true);
  });
  it.each([6, 18])('amounts use %i decimal tokenB', (decimals) => {
    const s = scenario(decimals);
    const d = decide(s.e, s.policy, s.mandate, s.state);
    expect(d.amountIn).toBe(100n * 10n ** BigInt(decimals));
    expect(d.minOut).toBe(units('98.703', 18));
  });
  it('sell uses tokenA decimals and tokenB minOut', () => {
    const s = scenario(18);
    s.state.balanceA = units(2000, 18);
    s.e.cex.forEach((c) => {
      c.bid = 0.98;
      c.ask = 0.98;
    });
    s.e.apro!.price = 0.98;
    const d = decide(s.e, s.policy, s.mandate, s.state);
    expect(d.direction).toBe('SELL_A');
    expect(d.amountIn).toBe(units(100, 18));
    expect(d.minOut).toBe(units('98.703', 18));
  });
});
describe('risk and quote boundaries', () => {
  it.each(['stale', 'future', 'crossed', 'duplicate'] as const)(
    'reject CEX %s',
    (test) => {
      const s = scenario();
      if (test === 'stale') s.e.cex[0].fetchedAt -= 61;
      if (test === 'future') s.e.cex[0].fetchedAt++;
      if (test === 'crossed') s.e.cex[0].ask = 1;
      if (test === 'duplicate') s.e.cex[0].venue = 'gate';
      expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('REJECT');
    },
  );
  it('reject missing and future APRO', () => {
    const s = scenario();
    delete s.e.apro;
    expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('REJECT');
    s.e.apro = { price: 1, updatedAt: s.e.now + 1, ageSec: -1 };
    expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('REJECT');
  });
  it('resizes for remaining daily budget', () => {
    const s = scenario();
    s.state.dailySpentB = s.mandate.maxDailyInB - units(25, 6);
    expect(decide(s.e, s.policy, s.mandate, s.state).sizeB).toBe(25);
  });
  it('resizes tokenA input cap on sell', () => {
    const s = scenario();
    s.state.balanceA = units(2000, 18);
    s.e.cex.forEach((c) => {
      c.bid = 0.98;
      c.ask = 0.98;
    });
    s.e.apro!.price = 0.98;
    s.mandate.maxTradeInA = units(25, 18);
    const d = decide(s.e, s.policy, s.mandate, s.state);
    expect(d.kind).toBe('RESIZE');
    expect(d.amountIn).toBe(units(25, 18));
  });
  it('cannot increase exposure above cap', () => {
    const s = scenario();
    s.mandate.maxExposureBps = 1200;
    expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('RESIZE');
  });
  it('sell can reduce risk even when still above cap', () => {
    const s = scenario();
    s.state.balanceA = units(2000, 18);
    s.mandate.maxExposureBps = 1000;
    s.e.cex.forEach((c) => {
      c.bid = 0.98;
      c.ask = 0.98;
    });
    s.e.apro!.price = 0.98;
    expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('TRADE');
  });
  it('mismatched quote amount cannot authorize a larger trade', () => {
    const s = scenario();
    s.e.quotes.forEach((q) => {
      q.amountIn += 1n;
    });
    expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('WAIT');
  });
  it('six hour DEX freshness boundary is inclusive', () => {
    const s = scenario();
    s.e.lastSwapAt = s.e.now - 21600;
    expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('TRADE');
  });
});
it('quote-vs-mid anomaly is a data-quality rejection', () => {
  const s = scenario();
  s.e.quotes[0].quotedOut *= 2n;
  const d = decide(s.e, s.policy, s.mandate, s.state);
  expect(d.kind).toBe('REJECT');
  expect(d.ruleTrace[0].detail).toBe('quote_vs_mid');
});
it('unrepresentable positive mid rejects instead of division by zero', () => {
  const s = scenario();
  s.e.dexMid = 1e-30;
  expect(decide(s.e, s.policy, s.mandate, s.state).kind).toBe('REJECT');
});
