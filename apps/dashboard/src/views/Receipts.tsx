import { useCallback } from 'react';
import { localReceipts, receiptLogs } from '../lib/receipts.js';
import { loadDeployment, explorerLink, type DashboardChain } from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
const kinds = ['TRADE','RESIZE','WAIT','REJECT'];
export function ReceiptsView({chain}: {chain: DashboardChain}) {
  const resource = useResource(useCallback(async () => {
    const [local, network] = await Promise.allSettled([localReceipts(), loadDeployment(chain).then(d => receiptLogs(chain,d))]);
    return {local: local.status === 'fulfilled' ? local.value : [], logs: network.status === 'fulfilled' ? network.value : [], localError: local.status === 'rejected' ? String(local.reason) : undefined, networkError: network.status === 'rejected' ? String(network.reason) : undefined};
  },[chain]));
  const data = resource.data;
  return <section><p className="eyebrow">03 / AUDIT TRAIL</p><h2>Decisions & receipts</h2><p>On-chain Receipt events joined by contract, transaction and receipt hash to locally served keeper records.</p>
    {resource.loading && <p role="status">Reading receipts…</p>}{resource.error && <p role="status">{resource.error}</p>}
    {data?.networkError && <p role="status">On-chain events unavailable — {data.networkError}</p>}{data?.localError && <p>Local receipts unavailable — {data.localError}</p>}
    {data && data.logs.length === 0 && <p>No on-chain events loaded for chain {chain}.</p>}
    {data?.logs.map(log => {const local = data.local.find(r => r.executionChainId === chain && r.contract.toLowerCase() === log.address.toLowerCase() && r.receiptHash === log.args.receiptHash && r.settlement?.transactionHash === log.transactionHash); const href = explorerLink(chain,'tx',log.transactionHash); return <article className="receipt" key={`${log.transactionHash}-${log.logIndex}`}><span className={`badge ${kinds[log.args.kind]}`}>{kinds[log.args.kind]}</span><h3>Receipt #{String(log.args.seq)}</h3><p>{local?.llm.explanation ?? 'Local explanation unavailable'}</p>{local?.ruleTrace.map((r,i)=><p key={i}>{r.pass ? 'PASS' : 'FAIL'} · {r.rule}: {r.detail}</p>)}<code>{log.args.receiptHash}</code><p>{href ? <a href={href} target="_blank" rel="noreferrer">Transaction ↗</a> : `Local Anvil transaction ${log.transactionHash}`}</p></article>;})}
    {data && data.local.filter(r => r.executionChainId === chain && !data.logs.some(l => l.transactionHash === r.settlement?.transactionHash && l.args.receiptHash === r.receiptHash)).map(r=><article className="receipt" key={r.receiptHash}><span className={`badge ${r.decision.kind}`}>{r.decision.kind}</span><h3>Local file · #{String(r.seq)}</h3><p>{chain === 31337 ? 'local anvil — prices not real' : 'Testnet — pool prices are not real'} · on-chain match UNVERIFIED</p><p>{r.llm.explanation}</p>{r.ruleTrace.map((t,i)=><p key={i}>{t.pass ? 'PASS' : 'FAIL'} · {t.rule}: {t.detail}</p>)}<code>{r.receiptHash}</code></article>)}
  </section>;
}
