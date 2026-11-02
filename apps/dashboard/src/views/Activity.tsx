import { useCallback, useState } from 'react';
import { demoContext, demoReceipts } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
import { displayTime, type DashboardChain } from '../lib/clients.js';
import { ReceiptsView } from './Receipts.js';
import { useAgentFeed } from '../agent/useAgentFeed.js';
import { FeedStatus } from '../components/FeedStatus.js';
import { DecisionHistory } from '../components/DecisionHistory.js';
const verdicts = ['All', 'TRADE', 'RESIZE', 'WAIT', 'REJECT'];
export default function ActivityView({
  chain,
  demo,
}: {
  chain: DashboardChain;
  demo: boolean;
}) {
  const [filter, setFilter] = useState('All');
  const observation = useAgentFeed(chain);
  const result = useResource(
    useCallback(async () => (demo ? demoContext() : null), [demo]),
  );
  const selected = new URLSearchParams(window.location.hash.split('?')[1]).get(
    'receipt',
  );
  return (
    <section className="activity-page">
      <div className="page-intro">
        <p className="eyebrow">ACTIVITY</p>
        <h1>Every decision. Accounted for.</h1>
        <p>
          Evidence, decisions and on-chain receipts. An intent is not an
          execution; a receipt is not independently verified until its checks
          pass.
        </p>
      </div>
      {demo ? (
        <>
          <p className="micro-label">
            RECORDED LOCAL ANVIL · OFFLINE RPC REPLAY · PRICES NOT REAL
          </p>
          <div
            role="group"
            aria-label="Filter recorded decisions"
            className="activity-filters"
          >
            {verdicts.map((v) => (
              <button
                className="text-action"
                aria-pressed={filter === v}
                onClick={() => setFilter(v)}
                key={v}
              >
                {v}
              </button>
            ))}
          </div>
          {result.error && (
            <p role="alert">Recorded verification unavailable.</p>
          )}
          <div className="activity-list">
            {[...demoReceipts]
              .reverse()
              .filter((r) => filter === 'All' || r.decision.kind === filter)
              .map((r) => {
                const index = demoReceipts.indexOf(r);
                return (
                  <details
                    key={r.receiptHash}
                    className="activity-row"
                    open={selected === r.receiptHash}
                  >
                    <summary>
                      <span className={`badge ${r.decision.kind}`}>
                        {r.decision.kind}
                      </span>
                      <span>
                        Receipt #{String(r.seq)}
                        <small>{r.llm.explanation}</small>
                      </span>
                      <time>{displayTime(Number(r.evidence.now))}</time>
                    </summary>
                    <div className="activity-detail">
                      <p className="micro-label">
                        {result.data?.results[index].status ?? 'NOT CHECKED'} ·
                        RECORDED RPC REPLAY
                      </p>
                      <dl>
                        <div>
                          <dt>Receipt commitment</dt>
                          <dd>
                            <code>{r.receiptHash}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Transaction</dt>
                          <dd>
                            <code>
                              {r.settlement?.transactionHash ?? 'Unavailable'}
                            </code>
                          </dd>
                        </div>
                      </dl>
                      <h3>Rule trace</h3>
                      <ol className="verification-checks">
                        {r.ruleTrace.map((t, i) => (
                          <li key={i}>
                            <b className={t.pass ? 'status-ok' : 'status-warn'}>
                              {t.pass ? 'PASS' : 'FAIL'}
                            </b>{' '}
                            · {t.rule}: {t.detail}
                          </li>
                        ))}
                      </ol>
                      <p>
                        Local Anvil recording; synthetic market scenarios. This
                        is not a live transaction.
                      </p>
                      {r.settlement?.transactionHash && (
                        <a href={`#/verify?tx=${r.settlement.transactionHash}`}>
                          Verify receipt →
                        </a>
                      )}
                    </div>
                  </details>
                );
              })}
          </div>
          {!demoReceipts.some(
            (r) => filter === 'All' || r.decision.kind === filter,
          ) && <p>No recorded decisions match this filter.</p>}
        </>
      ) : (
        <>
          <FeedStatus observation={observation} />
          <DecisionHistory
            actions={observation.feed?.actions ?? []}
            chain={chain}
            provenance={observation.provenance}
          />
          <details className="secondary-section">
            <summary>On-chain receipt records</summary>
            <ReceiptsView chain={chain} />
          </details>
        </>
      )}
    </section>
  );
}
