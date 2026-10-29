import { useCallback } from 'react';
import { localReceiptFiles, receiptLogs } from '../lib/receipts.js';
import {
  loadDeployment,
  explorerLink,
  type DashboardChain,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
const kinds = ['TRADE', 'RESIZE', 'WAIT', 'REJECT'];
export function ReceiptsView({ chain }: { chain: DashboardChain }) {
  const resource = useResource(
    useCallback(async () => {
      const [local, network] = await Promise.allSettled([
        localReceiptFiles(),
        loadDeployment(chain).then((d) => receiptLogs(chain, d)),
      ]);
      return {
        local: local.status === 'fulfilled' ? local.value.receipts : [],
        warnings: local.status === 'fulfilled' ? local.value.warnings : [],
        logs: network.status === 'fulfilled' ? network.value : [],
        localError:
          local.status === 'rejected' ? String(local.reason) : undefined,
        networkError:
          network.status === 'rejected' ? String(network.reason) : undefined,
      };
    }, [chain]),
  );
  const data = resource.data;
  return (
    <section>
      <p className="eyebrow">03 / AUDIT TRAIL</p>
      <h2>Decisions & receipts</h2>
      <p>
        On-chain Receipt events joined by contract, transaction and receipt hash
        to locally served keeper records.
      </p>
      {resource.loading && <p role="status">Reading receipts…</p>}
      {resource.error && <p role="status">{resource.error}</p>}
      {data?.networkError && (
        <p role="status">On-chain events unavailable — {data.networkError}</p>
      )}
      {data?.localError && (
        <p>Local receipts unavailable — {data.localError}</p>
      )}
      {data && data.logs.length === 0 && (
        <p>No on-chain events loaded for chain {chain}.</p>
      )}
      {data?.warnings.map((w) => (
        <p key={w}>{w}</p>
      ))}
      {data?.logs.map((log) => {
        const local = data.local.find(
          (r) =>
            r.executionChainId === chain &&
            r.contract.toLowerCase() === log.address.toLowerCase() &&
            r.receiptHash === log.args.receiptHash &&
            r.settlement?.transactionHash === log.transactionHash,
        );
        const href = explorerLink(chain, 'tx', log.transactionHash);
        return (
          <article
            className="receipt"
            key={`${log.transactionHash}-${log.logIndex}`}
          >
            <div className="receipt-card-header">
              <span className={`badge ${kinds[log.args.kind]}`}>
                {kinds[log.args.kind]}
              </span>
              <span className="receipt-seq-tag">RECEIPT #{String(log.args.seq)}</span>
            </div>
            <h3>Receipt #{String(log.args.seq)}</h3>
            <p className="receipt-explanation">{local?.llm.explanation ?? 'Local explanation unavailable'}</p>
            {local?.ruleTrace && local.ruleTrace.length > 0 && (
              <div className="receipt-rules-list">
                {local.ruleTrace.map((r, i) => (
                  <div key={i} className={`rule-check-item ${r.pass ? 'pass' : 'fail'}`}>
                    <span className="rule-status-badge">{r.pass ? 'PASS' : 'FAIL'}</span>
                    <span className="rule-name">{r.rule}:</span>
                    <span className="rule-detail">{r.detail}</span>
                  </div>
                ))}
              </div>
            )}
            <code>{log.args.receiptHash}</code>
            <p className="receipt-tx-link">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  Transaction ↗
                </a>
              ) : (
                `Local Anvil transaction ${log.transactionHash}`
              )}
            </p>
          </article>
        );
      })}
      {data &&
        data.local
          .filter(
            (r) =>
              r.executionChainId === chain &&
              !data.logs.some(
                (l) =>
                  l.transactionHash === r.settlement?.transactionHash &&
                  l.args.receiptHash === r.receiptHash,
              ),
          )
          .map((r) => (
            <article className="receipt" key={r.receiptHash}>
              <div className="receipt-card-header">
                <span className={`badge ${r.decision.kind}`}>
                  {r.decision.kind}
                </span>
                <span className="receipt-seq-tag">LOCAL RECORD #{String(r.seq)}</span>
              </div>
              <h3>Local file · #{String(r.seq)}</h3>
              <p className="receipt-sub-note">
                {chain === 31337
                  ? 'local anvil — prices not real'
                  : 'Testnet — pool prices are not real'}{' '}
                · on-chain match UNVERIFIED
              </p>
              <p className="receipt-explanation">{r.llm.explanation}</p>
              {r.ruleTrace && r.ruleTrace.length > 0 && (
                <div className="receipt-rules-list">
                  {r.ruleTrace.map((t, i) => (
                    <div key={i} className={`rule-check-item ${t.pass ? 'pass' : 'fail'}`}>
                      <span className="rule-status-badge">{t.pass ? 'PASS' : 'FAIL'}</span>
                      <span className="rule-name">{t.rule}:</span>
                      <span className="rule-detail">{t.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              <code>{r.receiptHash}</code>
            </article>
          ))}
    </section>
  );
}
