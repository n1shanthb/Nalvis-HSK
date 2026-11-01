import { useContext } from 'react';
import { LedgerContext } from '../owner/LedgerContext.js';
import type { DashboardChain } from '../lib/clients.js';
import type { AgentFeed } from '../agent/feed-types.js';
export function Readiness({
  feed,
  demo = false,
  chain = 133,
}: {
  feed: AgentFeed | null;
  demo?: boolean;
  chain?: DashboardChain;
}) {
  const ledger = useContext(LedgerContext);
  return (
    <div className="readiness-strip" aria-label="System readiness">
      <span className="micro-label">STATUS</span>
      <span>
        Ledger{' '}
        <b className={ledger?.address ? 'status-ok' : 'status-warn'}>
          {ledger?.address
            ? `${ledger.address.slice(0, 6)}…${ledger.address.slice(-4)}`
            : 'Not connected'}
        </b>
      </span>
      <span>
        Agent{' '}
        <b
          className={
            demo
              ? 'status-warn'
              : feed?.state.state === 'online'
                ? 'status-ok'
                : 'status-warn'
          }
        >
          {demo
            ? 'Recorded UI example'
            : feed
              ? feed.state.state
              : 'Feed unavailable'}
        </b>
      </span>
      <span>
        Execution{' '}
        <b>
          {demo
            ? 'Recorded Anvil · 31337'
            : chain === 133
              ? 'Testnet · 133'
              : chain === 31337
                ? 'Local Anvil · 31337'
                : import.meta.env.VITE_MAINNET_EXECUTION === 'true'
                  ? 'Mainnet · 177 · real funds'
                  : 'Mainnet · 177 · owner signing disabled'}
        </b>
      </span>
      <span className="micro-label">
        {demo ? 'PRICES NOT REAL' : 'MAINNET EVIDENCE · READ-ONLY'}
      </span>
    </div>
  );
}
