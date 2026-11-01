import { RecordedVaultValue } from '../components/RecordedVaultValue.js';
import { useCallback } from 'react';
import { formatUnits } from 'viem';
import { Readiness } from '../components/Readiness.js';
import { useAgentFeed } from '../agent/useAgentFeed.js';
import { useReceiptEvents } from '../agent/useReceiptEvents.js';
import { useResource } from '../lib/useResource.js';
import {
  loadDeployment,
  readVault,
  displayTime,
  type DashboardChain,
} from '../lib/clients.js';
import { demoContext, demoReceipts } from '../lib/demo.js';
import { ConnectLedger } from '../owner/ConnectLedger.js';
export default function WorkspaceOverview({
  chain,
  demo,
}: {
  chain: DashboardChain;
  demo: boolean;
}) {
  const { feed } = useAgentFeed();
  const events = useReceiptEvents(chain, !demo);
  const vault = useResource(
    useCallback(async () => {
      if (demo) return null;
      const deployment = await loadDeployment(chain);
      return readVault(chain, deployment.vault);
    }, [chain, demo]),
  );
  const recorded = useResource(
    useCallback(async () => (demo ? demoContext() : null), [demo]),
  );
  const mandate = demo ? recorded.data?.mandate : vault.data?.mandate;
  const decimals = demo
    ? recorded.data?.evidence.decimalsB
    : vault.data?.decimalsB;
  return (
    <section className="workspace-overview">
      <div className="page-intro">
        <p className="eyebrow">OVERVIEW</p>
        <h1>Your execution status</h1>
        <p>
          Set the authority. Inspect the evidence. Follow every decision through
          to its receipt.
        </p>
      </div>
      <Readiness feed={feed} demo={demo} chain={chain} />
      <section className="next-action">
        <p className="eyebrow">NEXT ACTION</p>
        <h2>
          {demo
            ? 'Explore a recorded execution'
            : vault.data
              ? 'Review your mandate and agent'
              : 'Connect Ledger and set your mandate'}
        </h2>
        <p>
          {demo
            ? 'Four genuine local Anvil receipts. Offline replay; synthetic market scenarios and prices are not real.'
            : 'Owner authority stays on your Ledger. Execution stays within the signed limits.'}
        </p>
        <div className="action-bar">
          <a className="button" href={demo ? '#/activity' : '#/setup'}>
            {demo ? 'Inspect activity' : 'Set mandate'}
          </a>
          {!demo && <ConnectLedger />}
          <span className="micro-label">
            {demo
              ? 'RECORDED SESSION'
              : vault.loading
                ? 'CHECKING DEPLOYMENT'
                : vault.data
                  ? 'DEPLOYMENT LOADED'
                  : 'DEPLOYMENT UNAVAILABLE'}
          </span>
        </div>
      </section>
      <div className="overview-columns">
        <section>
          <div className="section-line">
            <h2>Current mandate</h2>
            <a href="#/mandate">DETAILS →</a>
          </div>
          {mandate ? (
            <dl>
              <div>
                <dt>Expiry</dt>
                <dd>
                  {displayTime(mandate.expiry)}
                  {demo && ' · historical'}
                </dd>
              </div>
              <div>
                <dt>USDT per trade</dt>
                <dd>
                  {decimals === undefined
                    ? 'Unavailable'
                    : formatUnits(mandate.maxTradeInB, decimals)}
                </dd>
              </div>
              <div>
                <dt>Slippage ceiling</dt>
                <dd>{mandate.maxSlippageBps} bps</dd>
              </div>
            </dl>
          ) : (
            <p>
              {vault.loading
                ? 'Reading mandate…'
                : 'A verified mandate is not available. No authority or balance is assumed.'}
            </p>
          )}
          {!demo && vault.data && (
            <dl>
              <div>
                <dt>WHSK inventory</dt>
                <dd>
                  {vault.data.balanceA === undefined
                    ? 'Unavailable'
                    : formatUnits(vault.data.balanceA, vault.data.decimalsA)}
                </dd>
              </div>
              <div>
                <dt>USDT inventory</dt>
                <dd>
                  {vault.data.balanceB === undefined
                    ? 'Unavailable'
                    : formatUnits(vault.data.balanceB, vault.data.decimalsB)}
                </dd>
              </div>
            </dl>
          )}
          <a href="#/evidence">Inspect market evidence →</a>
        </section>
        <section>
          <div className="section-line">
            <h2>Latest activity</h2>
            <a href="#/activity">ALL →</a>
          </div>
          {demo ? (
            [...demoReceipts]
              .reverse()
              .slice(0, 4)
              .map((r) => (
                <a
                  className="activity-preview"
                  key={r.receiptHash}
                  href={`#/activity?receipt=${r.receiptHash}`}
                >
                  <span className={`badge ${r.decision.kind}`}>
                    {r.decision.kind}
                  </span>
                  <span>Receipt #{String(r.seq)}</span>
                  <time>{displayTime(Number(r.evidence.now))}</time>
                </a>
              ))
          ) : events.data?.length ? (
            events.data.slice(0, 5).map((r) => (
              <a
                className="activity-preview"
                key={r.transactionHash + r.logIndex}
                href={`#/verify?tx=${r.transactionHash}`}
              >
                <span className="badge">
                  {['TRADE', 'RESIZE', 'WAIT', 'REJECT'][r.args.kind ?? 3]}
                </span>
                <span>Receipt #{String(r.args.seq)}</span>
                <time>{displayTime(r.at)}</time>
              </a>
            ))
          ) : (
            <p>
              {events.error
                ? 'On-chain activity unavailable. Check deployment and RPC status.'
                : 'No on-chain receipts loaded.'}
            </p>
          )}
        </section>
      </div>
      {demo && <RecordedVaultValue />}
      {demo && recorded.data?.portfolio && (
        <section className="overview-performance">
          <div className="section-line">
            <h2>Recorded portfolio</h2>
            <span className="micro-label">LOCAL ANVIL · NOT REAL FUNDS</span>
          </div>
          <p>
            Excess versus hold after gas:{' '}
            <strong>
              {recorded.data.portfolio.excessVsHoldUSD.toFixed(4)} USD
            </strong>
            . No proven edge.
          </p>
        </section>
      )}
    </section>
  );
}
