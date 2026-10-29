import { useState } from 'react';
import { DeskParser, type DeskParseResult } from '@nalvis/core/index.js';
import { type DashboardChain } from '../lib/clients.js';

export function DeskView({ chain }: { chain: DashboardChain }) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<{ query: string; result: DeskParseResult; timestamp: string }[]>([
    {
      query: 'what is our current position?',
      timestamp: 'Just now',
      result: {
        intent: 'POSITION_PNL',
        response:
          'Current Position: 25.0000 WHSK, 1500.00 USDT (CEX mark: $55.45) | Excess vs Hold: +0.0000 USD',
      },
    },
  ]);

  const parser = new DeskParser();

  const handleQuery = (text: string) => {
    if (!text.trim()) return;

    const res = parser.parse(text, {
      state: {
        balanceA: 25000000000000000000n,
        balanceB: 1500000000n,
        initialBalanceA: 25000000000000000000n,
        initialBalanceB: 1500000000n,
      },
      decimalsA: 18,
      decimalsB: 6,
    });

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setHistory((prev) => [...prev, { query: text, result: res, timestamp: now }]);
    setQuery('');
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuery(query);
  };

  const sampleChips = [
    { label: '📊 View Positions & P&L', q: 'what is our position?' },
    { label: '🔍 Explain Last Decision', q: 'why did you wait or trade?' },
    { label: '📈 Check DEX-CEX Basis', q: 'what is the basis right now?' },
    { label: '🛡️ Reduce Risk (Conservative)', q: 'be more conservative' },
    { label: '🇮🇳 Hinglish: Mera P&L', q: 'mera pnl kitna hai?' },
    { label: '🚫 Security: Test Swap Refusal', q: 'swap now 50 USDT' },
  ];

  return (
    <section className="desk-panel" aria-label="Natural Language Desk">
      <div className="desk-header">
        <div>
          <p className="eyebrow">05 / TERMINAL INTENT INTERFACE</p>
          <h2>Trading Desk (Chain {chain})</h2>
        </div>
        <div className="desk-status-badge">
          <span className="dot pulse" />
          <span>DETERMINISTIC ENGINE · LLM ISOLATED</span>
        </div>
      </div>

      <div className="desk-stats-grid">
        <div className="desk-stat-card">
          <span className="stat-label">BOUNDED MODE</span>
          <span className="stat-value text-green">STRICT SANDBOX</span>
          <span className="stat-hint">No signing keys or raw transfers accessible</span>
        </div>
        <div className="desk-stat-card">
          <span className="stat-label">POLICY ENFORCEMENT</span>
          <span className="stat-value text-blue">LEDGER GATED</span>
          <span className="stat-hint">Changes validated against signed mandate</span>
        </div>
        <div className="desk-stat-card">
          <span className="stat-label">SUPPORTED LOCALES</span>
          <span className="stat-value text-purple">EN + HINGLISH</span>
          <span className="stat-hint">Deterministic intent & synonym matching</span>
        </div>
      </div>

      <div className="desk-chips-bar">
        <span className="chips-title">Quick Queries:</span>
        <div className="chips-container">
          {sampleChips.map((chip, idx) => (
            <button
              key={idx}
              type="button"
              className="chip-btn"
              onClick={() => handleQuery(chip.q)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="desk-terminal-window">
        <div className="terminal-topbar">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
          <span className="terminal-title">nalvis-desk-cli v1.0.0 — deterministic repl</span>
        </div>

        <div className="desk-chat-stream">
          {history.map((h, i) => (
            <div key={i} className="desk-message-block">
              <div className="desk-bubble user-bubble">
                <div className="bubble-header">
                  <span className="sender-tag">OPERATOR</span>
                  <span className="time-tag">{h.timestamp}</span>
                </div>
                <div className="bubble-content">{h.query}</div>
              </div>

              <div className={`desk-bubble bot-bubble intent-${h.result.intent.toLowerCase()}`}>
                <div className="bubble-header">
                  <span className={`intent-badge ${h.result.intent}`}>
                    {h.result.intent}
                  </span>
                  <span className="time-tag">DECISION ENGINE VERIFIED</span>
                </div>
                <div className="bubble-content">{h.result.response}</div>
                {h.result.diff && (
                  <pre className="bubble-json">{JSON.stringify(h.result.diff, null, 2)}</pre>
                )}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSend} className="terminal-input-bar">
          <span className="prompt-symbol">&gt;</span>
          <input
            type="text"
            className="terminal-input"
            placeholder="Ask positions, basis spread, rule trace, or type Hinglish queries..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="terminal-send-btn">
            RUN QUERY
          </button>
        </form>
      </div>
    </section>
  );
}
