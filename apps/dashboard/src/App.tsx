import type { OwnerProposal } from '../../../packages/core/src/desk/proposal.js';
import { lazy, Suspense, useEffect, useState } from 'react';
const MandateView = lazy(() =>
  import('./views/Mandate.js').then((m) => ({ default: m.MandateView })),
);
const EvidenceView = lazy(() =>
  import('./views/Evidence.js').then((m) => ({ default: m.EvidenceView })),
);
const ReceiptsView = lazy(() =>
  import('./views/Receipts.js').then((m) => ({ default: m.ReceiptsView })),
);
const VerifyView = lazy(() =>
  import('./views/Verify.js').then((m) => ({ default: m.VerifyView })),
);
import { type DashboardChain } from './lib/clients.js';
import './style.css';
const OwnerPanel = lazy(() => import('./owner/MandateForm.js'));
const DemoConsole = lazy(() =>
  import('./views/Console.js').then((m) => ({ default: m.DemoConsole })),
);
const DeskView = lazy(() =>
  import('./views/Desk.js').then((m) => ({ default: m.DeskView })),
);
const routes = ['mandate', 'evidence', 'receipts', 'verify', 'desk'] as const;
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
  const [demo, setDemo] = useState(
    import.meta.env.VITE_DEMO_MODE === 'true' ||
      new URLSearchParams(window.location.search).get('demo') === '1',
  );
  const [proposal, setProposal] = useState<OwnerProposal>();
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
          <label className="demo-toggle">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
            />{' '}
            Demo mode
          </label>
          <span className="dot" />{' '}
          <label>
            Execution network
            <select
              aria-label="Execution network"
              value={demo ? 31337 : chain}
              disabled={demo}
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
      {demo && (
        <div className="banner" role="note">
          DEMO · local anvil — prices not real · offline recorded receipts
        </div>
      )}
      {!demo && chain === 133 && (
        <div className="banner" role="note">
          Testnet — pool prices are not real
        </div>
      )}
      {!demo && chain === 31337 && (
        <div className="banner" role="note">
          local anvil — prices not real
        </div>
      )}
      {!demo && chain === 177 && (
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
            {
              [
                'Mandate',
                'Live evidence',
                'Decisions & receipts',
                'Verify',
                'Desk',
              ][i]
            }
          </a>
        ))}
      </nav>
      <main key={`${chain}-${route}-${demo}`}>
        <Suspense
          fallback={
            <div className="skeleton" role="status">
              Loading console…
            </div>
          }
        >
          {route === 'desk' ? (
            <DeskView
              demo={demo}
              chain={chain}
              onProposal={
                enableOwner && !demo && chain === 133
                  ? (p) => {
                      setProposal(p);
                      window.location.hash = '#/mandate';
                      setRoute('mandate');
                    }
                  : undefined
              }
            />
          ) : demo ? (
            <DemoConsole route={route} />
          ) : (
            <>
              {route === 'mandate' && (
                <MandateView
                  chain={chain}
                  onOwner={
                    enableOwner
                      ? (d, s) => (
                          <Suspense fallback={<p>Loading owner panel…</p>}>
                            <OwnerPanel
                              chain={chain}
                              vault={d.vault}
                              snapshot={s}
                              proposal={proposal}
                            />
                          </Suspense>
                        )
                      : undefined
                  }
                />
              )}{' '}
              {route === 'evidence' && <EvidenceView />}
              {route === 'receipts' && <ReceiptsView chain={chain} />}{' '}
              {route === 'verify' && <VerifyView chain={chain} />}
            </>
          )}
        </Suspense>
      </main>
      <footer>
        <span>Market evidence · mainnet 177 · read-only</span>
        <span>No proven edge. Bounded, provable execution.</span>
      </footer>
    </div>
  );
}
