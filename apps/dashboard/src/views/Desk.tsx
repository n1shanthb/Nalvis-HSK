import { useState, useCallback } from 'react';
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
export function DeskView({
  demo = false,
  chain = 133,
}: {
  demo?: boolean;
  chain?: DashboardChain;
}) {
  const resource = useResource(
    useCallback(
      async (): Promise<DeskContext> =>
        demo ? demoContext() : liveDeskContext(chain),
      [demo, chain],
    ),
  );
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<
    { input: string; reply: DeskReply }[]
  >([]);
  function submit(text: string) {
    if (!text.trim()) return;
    setMessages((m) => [
      ...m,
      { input: text, reply: desk(text, resource.data) },
    ]);
    setInput('');
  }
  return (
    <section>
      <p className="eyebrow">05 / NATURAL LANGUAGE DESK</p>
      <h2>Your evidence, explained.</h2>
      <p>
        Deterministic answers. Owner actions produce a diff and calldata hash
        for Ledger review.
      </p>
      <p className="muted">{supportedCommands}</p>
      {!demo && (
        <p>
          Uses verified locally served receipts on the selected network. Enable
          Demo mode for offline recorded evidence.
        </p>
      )}
      {resource.error && (
        <p role="alert">Recorded evidence unavailable: {resource.error}</p>
      )}
      <div>
        {['show P&L', 'kyu wait kiya', "what's the spread now", 'pause'].map(
          (t) => (
            <button key={t} className="secondary" onClick={() => submit(t)}>
              {t}
            </button>
          ),
        )}
      </div>
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
            <p>{m.reply.message}</p>
            {m.reply.diff && (
              <pre>
                {JSON.stringify(
                  { diff: m.reply.diff, calldataHash: m.reply.calldataHash },
                  null,
                  2,
                )}
              </pre>
            )}
            {m.reply.ruleTrace?.map((t, i) => (
              <p key={i}>
                {t.pass ? 'PASS' : 'FAIL'} · {t.rule}: {t.detail}
              </p>
            ))}
          </article>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
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
        <button disabled={!input.trim() || resource.loading}>Ask desk</button>
      </form>
    </section>
  );
}
