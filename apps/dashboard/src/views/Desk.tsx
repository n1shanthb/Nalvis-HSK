import type { OwnerProposal } from '../../../../packages/core/src/desk/proposal.js';
import { useState, useCallback, useEffect } from 'react';
import { z } from 'zod';
import {
  desk,
  supportedCommands,
  type DeskContext,
  type DeskReply,
} from '../../../../packages/core/src/desk/index.js';
import { liveDeskContext } from '../lib/desk-context.js';
import type { DashboardChain } from '../lib/clients.js';
import { demoContext } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
import { ExitReview } from '../components/ExitReview.js';
import { useAgentFeed } from '../agent/useAgentFeed.js';
const creditsSchema = z
  .object({
    remaining: z.number().int().nonnegative(),
    globalRemaining: z.number().int().nonnegative(),
    resetAt: z.number().int().positive(),
    retryAfter: z.number().int().nonnegative(),
  })
  .strict();
const providerSchema = z.object({
  providers: z.array(
    z.object({
      id: z.literal('openrouter'),
      available: z.boolean(),
    }),
  ),
  credits: creditsSchema.nullable(),
  status: z.enum(['disabled', 'unavailable', 'ready', 'exhausted']),
});
const translationSchema = z
  .object({
    provider: z.literal('openrouter'),
    model: z.string(),
    credits: creditsSchema,
    command: z.string().max(120),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    outputHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function DeskView({
  demo = false,
  chain = 133,
  onProposal,
  allowTrading = false,
}: {
  demo?: boolean;
  chain?: DashboardChain;
  onProposal?: (p: OwnerProposal) => void;
  allowTrading?: boolean;
}) {
  const resource = useResource(
    useCallback(
      async (): Promise<DeskContext> =>
        demo ? demoContext() : liveDeskContext(chain),
      [demo, chain],
    ),
  );
  const observation = useAgentFeed(chain, !demo);
  const [input, setInput] = useState('');
  const [buyAmount, setBuyAmount] = useState('1');
  const [reviewedBuyAmount, setReviewedBuyAmount] = useState<string | null>(null);
  const [provider, setProvider] = useState('openrouter');
  const [providers, setProviders] = useState<
    z.infer<typeof providerSchema>['providers']
  >([]);
  const [pending, setPending] = useState(false);
  const [credits, setCredits] = useState<z.infer<typeof creditsSchema> | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      fetch('/api/desk', { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          const status = providerSchema.parse(data);
          setProviders(status.providers);
          setCredits(status.credits);
          if (!status.providers.some((p) => p.available)) setProvider('rules');
          else setProvider('openrouter');
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setProviders([]);
            setCredits(null);
            setProvider('rules');
          }
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  const [messages, setMessages] = useState<
    {
      input: string;
      reply: DeskReply;
      interpretation?: string;
      source?: string;
      warning?: string;
      transcript?: { promptHash: string; outputHash: string };
    }[]
  >([]);
  async function submit(text: string) {
    if (!text.trim() || pending) return;
    setPending(true);
    setInput('');
    let command = text,
      source = 'Built-in commands',
      warning: string | undefined,
      transcript: { promptHash: string; outputHash: string } | undefined;
    try {
      if (provider !== 'rules') {
        const response = await fetch('/api/desk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, text }),
          signal: AbortSignal.timeout(15000),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const error = z
            .object({ credits: creditsSchema.nullable().optional() })
            .safeParse(body);
          if (error.success) setCredits(error.data.credits ?? null);
          if (response.status === 429) {
            setProvider('rules');
            warning =
              'AI request budget or rate limit reached. Using built-in commands.';
          }
          throw new Error('AI unavailable');
        }
        const result = translationSchema.parse(body);
        setCredits(result.credits);
        if (
          result.credits.remaining === 0 ||
          result.credits.globalRemaining === 0
        )
          setProvider('rules');
        command = result.command;
        source = `OpenRouter · ${result.model}`;
        transcript = {
          promptHash: result.promptHash,
          outputHash: result.outputHash,
        };
      }
    } catch {
      warning ??=
        'OpenRouter could not interpret this request. No trade was prepared. Retry, or use the BUY amount form below for a direct review.';
    }
    const latest = observation.feed?.actions.reduce(
      (best, action) => !best || action.at > best.at ? action : best,
      undefined as (typeof observation.feed.actions)[number] | undefined,
    );
    const liveContext: DeskContext = {
      ...(resource.data ?? {}),
      ...(latest && observation.provenance === 'live'
        ? {
            latestAction: { at: latest.at, kind: latest.final.kind, trail: latest.trail, txHash: latest.txHash },
            recentActions: observation.feed!.actions.map((action) => ({
              at: action.at, kind: action.final.kind, trail: action.trail, txHash: action.txHash,
            })),
          }
        : {}),
    };
    if (command.toLowerCase().replace(/[?!.]+$/, '') === 'show spread' && !demo) {
      try {
        const { collectCurrentEvidence } = await import('./Evidence.js');
        liveContext.evidence = await collectCurrentEvidence(chain);
        liveContext.evidenceLabel = 'Current market observation';
      } catch {
        warning = 'Current market evidence could not be loaded. Open Market to inspect source status.';
      }
    }
    setMessages((m) => [
      ...m,
      {
        input: text,
        reply: desk(command, liveContext),
        source,
        interpretation: command !== text ? command : undefined,
        warning,
        transcript,
      },
    ]);
    setPending(false);
  }
  return (
    <section className="copilot-page">
      <header className="copilot-page-header">
        <p className="eyebrow">05 / REVIEWED OWNER COMMANDS</p>
        <h2>Nalvis Copilot</h2>
        <p>
          Ask about the agent, inspect live evidence, or prepare a reviewed
          trade. Verified rules remain authoritative.
        </p>
      </header>
      <div className="copilot-layout">
        <section className="copilot-chat-panel" aria-label="Nalvis conversation">
          <header className="copilot-chat-header">
            <div>
              <strong><span className="copilot-online-dot" /> Nalvis</strong>
              <small>Grounded in the selected workspace</small>
            </div>
            <label className="copilot-engine">
              <span>Language engine</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={pending}
              >
                <option value="rules">Built-in commands</option>
                {(['openrouter'] as const).map((id) => (
                  <option
                    key={id}
                    value={id}
                    disabled={
                      !providers.find((p) => p.id === id)?.available ||
                      credits?.remaining === 0 ||
                      credits?.globalRemaining === 0
                    }
                  >
                    OpenRouter
                    {providers.find((p) => p.id === id)?.available
                      ? ''
                      : ' · not configured'}
                  </option>
                ))}
              </select>
            </label>
          </header>
          <div className="copilot-context-strip" aria-live="polite">
            <span>{provider === 'rules' ? 'Deterministic commands' : 'OpenRouter interpretation'}</span>
            <span>
              {credits
                ? `${credits.remaining} personal · ${credits.globalRemaining} shared calls left`
                : 'Provider credits unavailable'}
            </span>
            {credits && (
              <span className="sr-only">AI credits: {credits.remaining} remaining today</span>
            )}
            <span>{demo ? 'Recorded evidence' : `Chain ${chain} · live workspace`}</span>
          </div>
          <div className="conversation" role="log" aria-live="polite">
            {!messages.length && (
              <div className="chat-empty">
                <span className="chat-avatar" aria-hidden="true">N</span>
                <div>
                  <h3>What do you want to inspect?</h3>
                  <p>
                    Ask why the agent waited, check positions or spread, or
                    describe a trade you want reviewed.
                  </p>
                </div>
              </div>
            )}
            {resource.error && (
              <p className="chat-alert" role="alert">
                Recorded evidence unavailable: {resource.error}
              </p>
            )}
            {messages.map((m, i) => (
              <article className="chat-turn" key={i}>
                <div className="chat-message user-chat-message">
                  <div className="chat-bubble"><p>{m.input}</p></div>
                  <span className="chat-avatar user-avatar" aria-hidden="true">You</span>
                </div>
                <div className="chat-message assistant-chat-message">
                  <span className="chat-avatar" aria-hidden="true">N</span>
                  <div className="chat-bubble">
                    {m.source && (
                      <p className="ai-meta">
                        {m.source}
                        {m.interpretation && <> · Interpreted as <code>{m.interpretation}</code></>}
                      </p>
                    )}
                    {m.warning && <p className="ai-fallback" role="status">{m.warning}</p>}
                    <p>{m.reply.message}</p>
                    {(m.reply.intent.kind === 'exit' || m.reply.intent.kind === 'buy') &&
                      (demo || chain !== 177 ? (
                        <p>Owner-directed trades require the live mainnet workspace.</p>
                      ) : (
                        <ExitReview
                          allowTrading={allowTrading}
                          direction={m.reply.intent.kind === 'buy' ? 'BUY' : 'SELL'}
                          notionalB={m.reply.intent.kind === 'buy' ? m.reply.intent.notionalB : undefined}
                        />
                      ))}
                    {m.transcript && (
                      <details className="ai-meta">
                        <summary>Interpretation audit</summary>
                        <code>Prompt: {m.transcript.promptHash}<br />Output: {m.transcript.outputHash}</code>
                      </details>
                    )}
                    {m.reply.diff && <pre>{JSON.stringify({ diff: m.reply.diff, calldataHash: m.reply.calldataHash }, null, 2)}</pre>}
                    {m.reply.proposal && onProposal && (
                      <button className="secondary" onClick={() => onProposal(m.reply.proposal!)}>
                        Review exact proposal with Ledger
                      </button>
                    )}
                    {m.reply.ruleTrace?.map((trace, index) => (
                      <p className="ai-meta" key={index}>
                        {trace.pass ? 'PASS' : 'FAIL'} · {trace.rule}: {trace.detail}
                      </p>
                    ))}
                  </div>
                </div>
              </article>
            ))}
            {pending && <p className="desk-pending" role="status">Nalvis is interpreting your request…</p>}
          </div>
          <form
            className="copilot-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(input);
            }}
          >
            <label className="sr-only" htmlFor="copilot-message">Ask Nalvis</label>
            <input
              id="copilot-message"
              value={input}
              maxLength={500}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about a decision, position, or trade…"
            />
            <button aria-label="Ask Copilot" disabled={!input.trim() || resource.loading || pending}>
              Send
            </button>
          </form>
        </section>
        <aside className="copilot-action-rail" aria-label="Reviewed actions">
          {!demo && chain === 177 && (
            <section className="copilot-trade-card" aria-label="Direct BUY review">
              <div className="trade-card-heading">
                <span className="watch-kind">BUY</span>
                <span>USDT → WHSK</span>
              </div>
              <h3>Prepare a reviewed buy</h3>
              <p>Enter the exact amount to receive a fresh quote and mandate check.</p>
              <form
                className="copilot-buy-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (/^\d+(?:\.\d{1,6})?$/.test(buyAmount) && Number(buyAmount) > 0)
                    setReviewedBuyAmount(buyAmount);
                }}
              >
                <label htmlFor="copilot-buy-amount">Spend</label>
                <div className="amount-input">
                  <input
                    aria-label="Spend USDT"
                    id="copilot-buy-amount"
                    inputMode="decimal"
                    value={buyAmount}
                    onChange={(event) => {
                      setBuyAmount(event.target.value);
                      setReviewedBuyAmount(null);
                    }}
                    aria-describedby="copilot-buy-help"
                  />
                  <span>USDT</span>
                </div>
                <small id="copilot-buy-help">Current vault balance and mandate are checked.</small>
                <button
                  aria-label="Get fresh BUY review"
                  type="submit"
                  disabled={!/^\d+(?:\.\d{1,6})?$/.test(buyAmount) || Number(buyAmount) <= 0}
                >
                  Review buy
                </button>
              </form>
              {reviewedBuyAmount && (
                <ExitReview
                  key={reviewedBuyAmount}
                  allowTrading={allowTrading}
                  direction="BUY"
                  notionalB={reviewedBuyAmount}
                />
              )}
            </section>
          )}
          <details className="copilot-help-card">
            <summary>Capabilities and limits</summary>
            <p>{supportedCommands}</p>
            <p>
              Language interpretation cannot bypass the mandate. Never include
              keys or sensitive information.
            </p>
            {!demo && <p>Evidence comes from the selected live workspace.</p>}
          </details>
        </aside>
      </div>
    </section>
  );
}
