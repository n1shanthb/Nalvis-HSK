import { lazy, Suspense, useEffect, useState } from 'react';
import { MandateView } from './views/Mandate.js';
import { EvidenceView } from './views/Evidence.js';
import { ReceiptsView } from './views/Receipts.js';
import { VerifyView } from './views/Verify.js';
import { type DashboardChain } from './lib/clients.js';
import './style.css';
const OwnerPanel = lazy(() => import('./owner/MandateForm.js'));
const routes = ['mandate', 'evidence', 'receipts', 'verify'] as const;
export type Route = (typeof routes)[number];
export function App({
  initialChain = 133,
  initialRoute,
  enableOwner = import.meta.env.VITE_ENABLE_OWNER !== 'false',
}: {
  initialChain?: DashboardChain;
  initialRoute?: Route;
  enableOwner?: boolean;
}) {
  const [chain, setChain] = useState<DashboardChain>(initialChain);
  const readRoute = () =>
    routes.find((r) => `#/${r}` === window.location.hash) ?? 'mandate';
  const [route, setRoute] = useState<Route>(initialRoute ?? readRoute);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return (
    <div className="shell">
      <header>
        <a className="brand" href="#/mandate">
          <span className="brand-icon">N</span>
          <span>
            NALVIS <small>EDGEWISE × PROOFTRADE</small>
          </span>
        </a>
        <div className="network">
          <span className="dot" />{' '}
          <label>
            Execution network
            <select
              aria-label="Execution network"
              value={chain}
              onChange={(e) =>
                setChain(Number(e.target.value) as DashboardChain)
              }
            >
              <option value={133}>HashKey testnet · 133</option>
              <option value={31337}>Local Anvil · 31337</option>
              <option value={177}>Mainnet · 177 · read-only</option>
            </select>
          </label>
        </div>
      </header>
      <div className="intro">
        <p className="eyebrow">BOUNDED EXECUTION. VERIFIABLE DECISIONS.</p>
        <h1>
          Trust the limits.
          <br />
          <span>Inspect the evidence.</span>
        </h1>
        <p>A Ledger-governed mandate and a receipt for every decision.</p>
      </div>
      {chain === 133 && (
        <div className="banner" role="note">
          Testnet — pool prices are not real
        </div>
      )}
      {chain === 31337 && (
        <div className="banner" role="note">
          local anvil — prices not real
        </div>
      )}
      {chain === 177 && (
        <div className="banner" role="note">
          Mainnet 177 — read-only
        </div>
      )}
      <nav aria-label="Dashboard views">
        {routes.map((r, i) => (
          <a
            key={r}
            href={`#/${r}`}
            aria-current={route === r ? 'page' : undefined}
            onClick={() => setRoute(r)}
          >
            <small>0{i + 1}</small>{' '}
            {['Mandate', 'Live evidence', 'Decisions & receipts', 'Verify'][i]}
          </a>
        ))}
      </nav>
      <main key={`${chain}-${route}`}>
        {route === 'mandate' && (
          <MandateView
            chain={chain}
            onOwner={
              enableOwner
                ? (d, s) => (
                    <Suspense fallback={<p>Loading owner panel…</p>}>
                      <OwnerPanel chain={chain} vault={d.vault} snapshot={s} />
                    </Suspense>
                  )
                : undefined
            }
          />
        )}{' '}
        {route === 'evidence' && <EvidenceView />}
        {route === 'receipts' && <ReceiptsView chain={chain} />}{' '}
        {route === 'verify' && <VerifyView chain={chain} />}
      </main>
      <footer>
        <span>Market evidence · mainnet 177 · read-only</span>
        <span>No proven edge. Bounded, provable execution.</span>
      </footer>
    </div>
  );
}
