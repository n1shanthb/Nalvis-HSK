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
        'AI unavailable or unable to interpret this request. Answered using the original text and built-in commands.';
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
    <section>
      <p className="eyebrow">05 / REVIEWED OWNER COMMANDS</p>
      <h2>Nalvis Copilot</h2>
      <p>
        Answers use current market reads and the observed agent feed. Buy and
        sell requests produce a fresh review card; mandate changes require
        Ledger review.
      </p>
      <div className="desk-toolbar">
        <label>
          Language engine{' '}
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
        <p>
          {provider === 'rules'
            ? providers.some((p) => p.available)
              ? 'Choose OpenRouter, or use built-in commands without a key.'
              : 'OpenRouter not configured. Built-in commands are available.'
            : 'AI interprets language only. Verified rules decide.'}
        </p>
      </div>
      <p className="ai-meta" aria-live="polite">
        {credits
          ? `AI credits: ${credits.remaining} remaining today · shared daily budget: ${credits.globalRemaining} calls remaining. Resets ${new Date(credits.resetAt * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.${credits.retryAfter ? ` Rate limit: retry in ${credits.retryAfter}s.` : ''}`
          : 'AI credits unavailable · providers are disabled until shared budgets and credentials are configured.'}
      </p>
      <details className="desk-supported">
        <summary>What can I ask?</summary>
        <p className="muted">{supportedCommands}</p>
        <p>
          AI requests send your text to the selected provider. Never include
          keys or sensitive information. Proposals always require separate owner
          review; this conversation does not execute trades.
        </p>
      </details>
      {!demo && (
        <p>
          Uses verified locally served receipts on the selected network. Enable
          Demo mode for offline recorded evidence.
        </p>
      )}
      {resource.error && (
        <p role="alert">Recorded evidence unavailable: {resource.error}</p>
      )}
      <div className="conversation" role="log" aria-live="polite">
        {!messages.length && (
          <p>
            Ask about a decision, inspect positions, or prepare an owner
            proposal.
          </p>
        )}
        {messages.map((m, i) => (
          <article key={i}>
            <p className="user-message">{m.input}</p>
            {m.source && (
              <p className="ai-meta">
                {m.source}
                {m.interpretation && (
                  <>
                    {' '}
                    · Interpreted as <code>{m.interpretation}</code>
                  </>
                )}
              </p>
            )}
            {m.warning && (
              <p className="ai-fallback" role="status">
                {m.warning}
              </p>
            )}
            <p>{m.reply.message}</p>
            {(m.reply.intent.kind === 'exit' || m.reply.intent.kind === 'buy') &&
              (demo || chain !== 177 ? (
                <p>
                  Owner-directed exits require the live mainnet workspace. No
                  swap is submitted from recorded examples.
                </p>
              ) : (
                <ExitReview
                  allowTrading={allowTrading}
                  direction={m.reply.intent.kind === 'buy' ? 'BUY' : 'SELL'}
                  notionalB={m.reply.intent.kind === 'buy' ? m.reply.intent.notionalB : undefined}
                />
              ))}
            {m.transcript && (
              <details className="ai-meta">
                <summary>Interpretation transcript hashes</summary>
                <p>
                  SHA-256 · audit metadata for this conversation, not an
                  on-chain receipt.
                </p>
                <code>
                  Prompt: {m.transcript.promptHash}
                  <br />
                  Output: {m.transcript.outputHash}
                </code>
              </details>
            )}
            {m.reply.diff && (
              <pre>
                {JSON.stringify(
                  { diff: m.reply.diff, calldataHash: m.reply.calldataHash },
                  null,
                  2,
                )}
              </pre>
            )}
            {m.reply.proposal && onProposal && (
              <button
                className="secondary"
                onClick={() => onProposal(m.reply.proposal!)}
              >
                Review exact proposal with Ledger
              </button>
            )}
            {m.reply.ruleTrace?.map((t, i) => (
              <p key={i}>
                {t.pass ? 'PASS' : 'FAIL'} · {t.rule}: {t.detail}
              </p>
            ))}
          </article>
        ))}
        {pending && (
          <p className="desk-pending" role="status">
            Interpreting your request…
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
      >
        <label>
          Ask Nalvis
          <input
            value={input}
            maxLength={500}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Why did you WAIT last?"
          />
        </label>
        <button disabled={!input.trim() || resource.loading || pending}>
          Ask Copilot
        </button>
      </form>
    </section>
  );
}
