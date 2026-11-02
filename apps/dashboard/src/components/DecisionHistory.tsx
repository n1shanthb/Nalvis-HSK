import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionView } from '../agent/feed-types.js';
import {
  clientFor,
  displayTime,
  explorerLink,
  type DashboardChain,
} from '../lib/clients.js';
import { invalidateReads, useResource } from '../lib/useResource.js';
import { DecisionArtifacts } from './DecisionArtifacts.js';
import { TransactionReceiptNotFoundError } from 'viem';
const actionKey = (action: ActionView) =>
  `${action.at}:${action.receiptHash ?? `${action.intent.type}:${action.final.kind}`}`;

export function TransactionState({
  hash,
  chain,
}: {
  hash: string;
  chain: DashboardChain;
}) {
  const mined = useRef(false);
  const resource = useResource(
    useCallback(async () => {
      if (!/^0x[\da-f]{64}$/i.test(hash))
        throw Error('Invalid transaction hash');
      const client = clientFor(chain);
      if ((await client.getChainId()) !== chain)
        throw Error('RPC chain mismatch');
      try {
        return {
          phase: 'mined' as const,
          receipt: await client.getTransactionReceipt({
            hash: hash as `0x${string}`,
          }),
        };
      } catch (error) {
        if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
        const transaction = await client.getTransaction({
          hash: hash as `0x${string}`,
        });
        return {
          phase:
            transaction.blockNumber === null
              ? ('pending' as const)
              : ('submitted' as const),
        };
      }
    }, [hash, chain]),
  );
  useEffect(() => {
    if (
      resource.data?.phase === 'mined' &&
      resource.data.receipt.status === 'success' &&
      !mined.current
    ) {
      mined.current = true;
      invalidateReads();
    }
  }, [resource.data]);
  const receipt = resource.data?.receipt;
  return (
    <p>
      {receipt
        ? receipt.status === 'success'
          ? `Mined successfully · block ${receipt.blockNumber}`
          : `Failed on-chain · block ${receipt.blockNumber}`
        : resource.data
          ? resource.data.phase === 'pending'
            ? 'Submitted · pending — not confirmed.'
            : resource.data.phase === 'submitted'
              ? 'Submitted · awaiting transaction receipt — not confirmed.'
              : 'Confirmation unavailable.'
          : resource.loading
            ? 'Checking transaction receipt…'
            : 'Confirmation unavailable — pending, not found or RPC unavailable. A hash does not confirm execution.'}
      {resource.data &&
        resource.error &&
        ' · Receipt refresh failed; showing last observation.'}{' '}
      Independent receipt verification: not checked.
    </p>
  );
}

export function DecisionHistory({
  actions,
  chain,
  provenance,
}: {
  actions: ActionView[];
  chain: DashboardChain;
  provenance: string;
}) {
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [rawOpened, setRawOpened] = useState<Record<string, boolean>>({});
  return (
    <section aria-label="Decision history" className="decision-history">
      <h2>Decision history</h2>
      <p>
        {provenance === 'demo'
          ? 'DEMO fixture · execution chain unavailable'
          : `${provenance} · chain ${chain}`}{' '}
        · oldest to newest
      </p>
      {!actions.length && (
        <p>No agent decisions available in this observation.</p>
      )}
      <ol className="decision-timeline">
        {[...actions]
          .sort((a, b) => a.at - b.at)
          .map((action) => (
            <li key={actionKey(action)}>
              <details
                className="activity-row"
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setOpened((previous) => ({
                    ...previous,
                    [actionKey(action)]: open,
                  }));
                }}
              >
                <summary>
                  <span className={`badge ${action.final.kind}`}>
                    {action.final.kind}
                  </span>
                  <span>Decision details · {displayTime(action.at)}</span>
                </summary>
                <div className="activity-detail">
                  <h3>Original agent intent → final outcome</h3>
                  <p>
                    {action.intent.type} · {action.intent.notionalB} USDT
                    requested → {action.final.kind}
                    {action.final.direction
                      ? ` · ${action.final.direction}`
                      : ''}
                  </p>
                  <p className="decision-explanation">
                    {action.trail || 'Explanation unavailable in feed.'}
                  </p>
                  {(action.final.kind === 'WAIT' ||
                    action.final.kind === 'REJECT') && (
                    <p>Hold decision — a receipt is not a swap.</p>
                  )}
                  <p>
                    Evidence time / block: unavailable in the action feed.
                    Inspect the keeper receipt in Verify for evidence
                    provenance.
                  </p>
                  {opened[actionKey(action)] &&
                    action.receiptHash &&
                    provenance !== 'demo' && (
                      <DecisionArtifacts
                        receiptHash={action.receiptHash}
                        chain={chain}
                        provenance={provenance}
                      />
                    )}
                  <h4>Negotiation rounds</h4>
                  {action.rounds.length ? (
                    <ol>
                      {action.rounds.map((round, i) => (
                        <li key={i}>
                          {round.role} · round {round.round}: {round.summary}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No negotiation rounds supplied.</p>
                  )}
                  <h4>Validation / rejection reasons</h4>
                  {action.violations.length ? (
                    <ul>
                      {action.violations.map((v, i) => (
                        <li key={i}>
                          {v.limit}: {v.required} requested / {v.allowed}{' '}
                          allowed
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      No violations supplied; this does not establish
                      independent verification.
                    </p>
                  )}
                  {action.txHash && (
                    <>
                      {explorerLink(chain, 'tx', action.txHash) && (
                        <a href={explorerLink(chain, 'tx', action.txHash)}>
                          Transaction ↗
                        </a>
                      )}{' '}
                      <a
                        href={`#/verify?tx=${encodeURIComponent(action.txHash)}`}
                      >
                        Verify receipt
                      </a>
                      {provenance === 'live' && opened[actionKey(action)] ? (
                        <TransactionState hash={action.txHash} chain={chain} />
                      ) : (
                        <p>
                          Recorded transaction hash — current submission and
                          confirmation unavailable. Verification not checked.
                        </p>
                      )}
                    </>
                  )}
                  {!action.txHash && (
                    <p>
                      Submission / confirmation: unavailable. Verification: not
                      checked.
                    </p>
                  )}
                  <details
                    className="technical-details"
                    onToggle={(event) => {
                      event.stopPropagation();
                      const open = event.currentTarget.open;
                      setRawOpened((previous) => ({
                        ...previous,
                        [actionKey(action)]: open,
                      }));
                    }}
                  >
                    <summary>Hashes and original action JSON</summary>
                    <dl>
                      <div>
                        <dt>Receipt hash</dt>
                        <dd>
                          <code>{action.receiptHash ?? 'Unavailable'}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Transaction hash</dt>
                        <dd>
                          <code>{action.txHash ?? 'Unavailable'}</code>
                        </dd>
                      </div>
                    </dl>
                    {rawOpened[actionKey(action)] && (
                      <pre>{JSON.stringify(action, null, 2)}</pre>
                    )}
                  </details>
                </div>
              </details>
            </li>
          ))}
      </ol>
    </section>
  );
}
