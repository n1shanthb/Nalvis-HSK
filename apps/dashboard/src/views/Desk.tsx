import { useState, useCallback } from 'react';
import { DeskParser, type DeskParseResult } from '@nalvis/core';
import { policySchema } from '@nalvis/core/policy.js';
import policyJSON from '../../../../policy/default.json';
import {
  loadDeployment,
  readVault,
  clientFor,
  type DashboardChain,
  type VaultSnapshot,
} from '../lib/clients.js';
import { localReceiptFiles } from '../lib/receipts.js';
import { collectEvidence } from '@nalvis/core/evidence.js';
import { useResource } from '../lib/useResource.js';

const policy = policySchema.parse(policyJSON);

interface HistoryItem {
  query: string;
  result: DeskParseResult;
  timestamp: string;
  llmUsed?: boolean;
  model?: string;
  promptHash?: string;
}

export function DeskView({ chain }: { chain: DashboardChain }) {
  const [query, setQuery] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Load real vault state, live evidence, and last recorded decision
  const resource = useResource(
    useCallback(async () => {
      const [deployment, localReceiptsData] = await Promise.all([
        loadDeployment(chain).catch(() => undefined),
        localReceiptFiles().catch(() => ({ receipts: [], warnings: [] })),
      ]);

      let snapshot: VaultSnapshot | undefined;
      if (deployment?.vault) {
        snapshot = await readVault(chain, deployment.vault).catch(() => undefined);
      }

      // Collect real market evidence from mainnet 177
      let evidence: Awaited<ReturnType<typeof collectEvidence>> | undefined;
      try {
        const marketClient = clientFor(177);
        const execClient = clientFor(chain === 177 ? 177 : 133);
        const sizes = [
          ...new Set(Object.values(policy.presets).flatMap((p) => p.sizeGridB)),
        ].sort((a, b) => a - b);
        evidence = await collectEvidence({
          marketClient177: marketClient,
          execClient,
          sizes,
        });
      } catch {
        // Live evidence network error or offline
      }

      // Find last local decision for this execution chain
      const lastReceipt = localReceiptsData.receipts
        .filter((r) => r.executionChainId === chain)
        .sort((a, b) => Number(b.seq - a.seq))[0];

      return {
        snapshot,
        evidence,
        lastDecision: lastReceipt?.decision,
      };
    }, [chain]),
  );

  const parser = new DeskParser();

  const handleQuery = async (text: string) => {
    if (!text.trim() || isEvaluating) return;

    setIsEvaluating(true);
    const data = resource.data;
    const m = data?.snapshot?.mandate;
    const mandate = m
      ? {
          expiry: Number(m.expiry),
          revoked: m.agent === '0x0000000000000000000000000000000000000000',
          maxTradeInA: m.maxTradeInA,
          maxTradeInB: m.maxTradeInB,
          maxDailyInB: m.maxDailyInB,
          maxExposureBps: m.maxExposureBps,
          maxSlippageBps: m.maxSlippageBps,
          minIntervalSec: Number(m.minIntervalSec),
          policyHash: m.policyHash,
        }
      : undefined;

    const deskContext = {
      evidence: data?.evidence,
      mandate,
      policy,
      state: data?.snapshot
        ? {
            balanceA: data.snapshot.mandate.maxTradeInA,
            balanceB: data.snapshot.mandate.maxTradeInB,
            lastDecision: data.lastDecision,
          }
        : undefined,
      decimalsA: data?.snapshot?.decimalsA ?? 18,
      decimalsB: data?.snapshot?.decimalsB ?? 6,
    };

    let finalResult: DeskParseResult;
    let llmUsed = false;
    let modelName: string | undefined;
    let promptHash: string | undefined;

    try {
      // Attempt call to serverless proxy /api/desk
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          ...deskContext,
        }),
      });

      if (res.ok) {
        const body = (await res.json()) as {
          llmUsed: boolean;
          model?: string;
          promptHash?: string;
          result: DeskParseResult;
        };
        finalResult = body.result;
        llmUsed = body.llmUsed;
        modelName = body.model;
        promptHash = body.promptHash;
      } else {
        // Fallback to local deterministic parser
        finalResult = parser.parse(text, deskContext);
      }
    } catch {
      // Network or API offline: rule-based fallback
      finalResult = parser.parse(text, deskContext);
    } finally {
      setIsEvaluating(false);
    }

    const now = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    setHistory((prev) => [
      ...prev,
      {
        query: text,
        result: finalResult,
        timestamp: now,
        llmUsed,
        model: modelName,
        promptHash,
      },
    ]);
    setQuery('');
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    void handleQuery(query);
  };

  const sampleChips = [
    { label: 'View Positions & P&L', q: 'what is our position?' },
    { label: 'Explain Last Decision', q: 'why did you wait or trade?' },
    { label: 'Check DEX-CEX Basis', q: 'what is the basis right now?' },
    { label: 'Reduce Risk (Conservative)', q: 'be more conservative' },
    { label: 'Pause Vault (Prepare)', q: 'pause vault' },
    { label: 'Revoke Agent (Prepare)', q: 'revoke' },
    { label: 'Hinglish: Mera P&L', q: 'mera pnl kitna hai?' },
    { label: 'Security: Test Swap Refusal', q: 'swap now 50 USDT' },
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
          <span>HYBRID DESK · GROQ LLM + DETERMINISTIC ENGINE</span>
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
          <span className="stat-label">LIVE CONTEXT</span>
          <span className="stat-value text-purple">
            {resource.loading
              ? 'READING...'
              : resource.data?.snapshot
                ? 'VAULT CONNECTED'
                : 'OFFLINE / UNLISTED'}
          </span>
          <span className="stat-hint">Real evidence & vault parameters only</span>
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
              disabled={isEvaluating}
              onClick={() => void handleQuery(chip.q)}
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
          <span className="terminal-title">NALVIS INTENT TERMINAL // GROQ LLM + DETERMINISTIC VERIFIER</span>
        </div>

        <div className="desk-chat-stream">
          {history.length === 0 && (
            <div className="terminal-empty-state">
              <p>Type a natural language query or select a quick query chip above.</p>
              <small>Dual pipeline: Groq LLM parses intents & grounded facts; deterministic engine validates strictly against mandate.</small>
            </div>
          )}
          {history.map((item, idx) => (
            <div key={idx} className="desk-message-block">
              <div className="desk-bubble user-bubble">
                <span className="sender-tag">OPERATOR ({item.timestamp}):</span>
                <p>{item.query}</p>
              </div>
              <div
                className={`desk-bubble bot-bubble ${
                  item.result.intent === 'REFUSAL' ? 'intent-refusal' : ''
                }`}
              >
                <div className="bubble-header">
                  <span className="sender-tag">NALVIS DESK:</span>
                  <div className="badge-group">
                    {item.llmUsed ? (
                      <span className="mode-badge llm-mode">
                        GROQ LLM ({item.model})
                      </span>
                    ) : (
                      <span className="mode-badge rule-mode">
                        RULE-BASED MODE
                      </span>
                    )}
                    <span className={`intent-badge ${item.result.intent}`}>
                      {item.result.intent}
                    </span>
                  </div>
                </div>
                <p>{item.result.response}</p>
                {item.promptHash && (
                  <div className="bubble-calldata-box">
                    <span>PROMPT HASH:</span>
                    <code>{item.promptHash}</code>
                  </div>
                )}
                {item.result.calldataHash && (
                  <div className="bubble-calldata-box">
                    <span>CALLDATA HASH:</span>
                    <code>{item.result.calldataHash}</code>
                  </div>
                )}
                {item.result.preparedAction && (
                  <div className="bubble-prepared-box">
                    <span>PREPARED ACTION NOTICE:</span>
                    <p>{item.result.preparedAction.notice}</p>
                    <code>Exact Calldata: {item.result.preparedAction.calldata}</code>
                  </div>
                )}
                {item.result.diff && (
                  <pre className="bubble-json">
                    {JSON.stringify(item.result.diff, null, 2)}
                  </pre>
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
            placeholder={
              isEvaluating
                ? 'Evaluating with Groq & deterministic engine...'
                : 'Ask about positions, P&L, basis, why WAIT/REJECT, or propose param adjustments...'
            }
            value={query}
            disabled={isEvaluating}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="terminal-send-btn" disabled={isEvaluating || !query.trim()}>
            {isEvaluating ? 'Evaluating...' : 'Evaluate'}
          </button>
        </form>
      </div>
    </section>
  );
}
