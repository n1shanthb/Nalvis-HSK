import { useState } from 'react';
import { DeskParser, type DeskParseResult } from '../../../../packages/core/src/index.js';
import { type DashboardChain } from '../lib/clients.js';

export function DeskView({ chain }: { chain: DashboardChain }) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<{ query: string; result: DeskParseResult }[]>([
    {
      query: 'what is our current position?',
      result: {
        intent: 'POSITION_PNL',
        response:
          'Current Position: 25.0000 WHSK, 1500.00 USDT (CEX mark: $55.45) | Excess vs Hold: +0.0000 USD',
      },
    },
  ]);

  const parser = new DeskParser();

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const res = parser.parse(query, {
      state: {
        balanceA: 25000000000000000000n,
        balanceB: 1500000000n,
        initialBalanceA: 25000000000000000000n,
        initialBalanceB: 1500000000n,
      },
      decimalsA: 18,
      decimalsB: 6,
    });

    setHistory((prev) => [...prev, { query, result: res }]);
    setQuery('');
  };

  return (
    <section className="desk-panel" aria-label="Natural Language Desk">
      <h2>Deterministic Trading Desk (Chain {chain})</h2>
      <p className="hint">
        Query positions, inspect decision traces, examine DEX/CEX basis, and propose parameter updates.
        Strict security boundary: desk cannot sign or broadcast transactions.
      </p>

      <div className="desk-chat" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', margin: '1rem 0' }}>
        {history.map((h, i) => (
          <div key={i} className="desk-bubble-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div
              className="desk-user-msg"
              style={{
                alignSelf: 'flex-end',
                background: 'var(--panel-bg, #1a1e24)',
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                border: '1px solid #333',
              }}
            >
              <strong>You:</strong> {h.query}
            </div>
            <div
              className={`desk-bot-msg ${h.result.intent.toLowerCase()}`}
              style={{
                alignSelf: 'flex-start',
                background: h.result.intent === 'REFUSAL' ? '#2a1a1a' : '#141c1f',
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                border: h.result.intent === 'REFUSAL' ? '1px solid #722' : '1px solid #234',
              }}
            >
              <strong>Desk [{h.result.intent}]:</strong> {h.result.response}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <input
          type="text"
          placeholder="Ask e.g. 'what is our position?', 'why did we wait?', 'be more conservative'..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '0.6rem',
            background: '#0d1117',
            color: '#fff',
            border: '1px solid #30363d',
            borderRadius: '6px',
          }}
        />
        <button type="submit" style={{ padding: '0.6rem 1.2rem', cursor: 'pointer' }}>
          Send
        </button>
      </form>
    </section>
  );
}
