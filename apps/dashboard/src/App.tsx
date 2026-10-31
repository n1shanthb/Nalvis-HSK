import { DemoMandate } from './owner/DemoMandate.js';
import { Header } from './components/Header.js';
import { AgentView } from './views/Agent.js';
import { MandateWizard } from './owner/MandateWizard.js';
import { OwnerActions } from './owner/OwnerActions.js';
import { Landing } from './views/Landing.js';
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
const routes = [
  'mandate',
  'evidence',
  'receipts',
  'verify',
  'desk',
  'agent',
] as const;
type AppRoute = Route | 'home';
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
  const [demo] = useState(
    new URLSearchParams(window.location.search).get('demo') === '1',
  );
  const [proposal, setProposal] = useState<OwnerProposal>();
  const [chain] = useState<DashboardChain>(initialChain);
  const readRoute = () => {
    const path = window.location.hash.split('?')[0];
    if (path === '#/evidence' || path === '#/receipts') {
      window.history.replaceState(null, '', `${window.location.search}#/agent`);
      return 'agent' as const;
    }
    return routes.find((r) => `#/${r}` === path) ?? 'home';
  };
  const [deskOpen, setDeskOpen] = useState(false);
  const [route, setRoute] = useState<AppRoute>(initialRoute ?? readRoute);
  useEffect(() => {
    if (route === 'desk') {
      setDeskOpen(true);
      setRoute('agent');
      window.history.replaceState(null, '', `${window.location.search}#/agent`);
    }
  }, [route]);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  if (route === 'home') return <Landing />;
  return (
    <div className="shell ux-shell">
      <Header demo={demo} onDesk={() => setDeskOpen(true)} />
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
      <main key={`${chain}-${route}-${demo}`}>
        <Suspense
          fallback={
            <div className="skeleton" role="status">
              Loading console…
            </div>
          }
        >
          {route === 'agent' ? (
            <AgentView chain={chain} />
          ) : route === 'desk' ? (
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
          ) : route === 'verify' ? (
            <VerifyView chain={demo ? 31337 : chain} />
          ) : demo && route === 'mandate' ? (
            <DemoMandate />
          ) : demo ? (
            <DemoConsole route={route} />
          ) : (
            <>
              {route === 'mandate' && (
                <MandateView
                  chain={chain}
                  onOwner={
                    enableOwner
                      ? (d, s, reload) => (
                          <Suspense fallback={<p>Loading owner panel…</p>}>
                            <MandateWizard
                              chain={chain}
                              vault={d.vault}
                              snapshot={s}
                              onConfirmed={reload}
                            />
                            <OwnerActions
                              chain={chain}
                              vault={d.vault}
                              snapshot={s}
                              onConfirmed={reload}
                            />
                            {proposal && (
                              <OwnerPanel
                                chain={chain}
                                vault={d.vault}
                                snapshot={s}
                                proposal={proposal}
                              />
                            )}
                          </Suspense>
                        )
                      : undefined
                  }
                />
              )}{' '}
              {route === 'evidence' && <EvidenceView />}
              {route === 'receipts' && <ReceiptsView chain={chain} />}{' '}
            </>
          )}
        </Suspense>
      </main>
      {deskOpen && (
        <div
          className="desk-backdrop"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDeskOpen(false);
            if (event.key === 'Tab') {
              const dialog =
                event.currentTarget.querySelector('[role="dialog"]');
              const controls = dialog?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary',
              );
              const first = controls?.[0],
                last = controls?.[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <aside
            className="desk-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="AI desk"
          >
            <button autoFocus onClick={() => setDeskOpen(false)}>
              Close desk
            </button>
            <Suspense fallback={<p>Loading desk…</p>}>
              <DeskView
                demo={demo}
                chain={chain}
                onProposal={
                  enableOwner && !demo && chain === 133
                    ? (p) => {
                        setProposal(p);
                        window.location.hash = '#/mandate';
                        setRoute('mandate');
                        setDeskOpen(false);
                      }
                    : undefined
                }
              />
            </Suspense>
          </aside>
        </div>
      )}
      <footer>
        <span>Market evidence · mainnet 177 · read-only</span>
        <span>No proven edge. Bounded, provable execution.</span>
      </footer>
    </div>
  );
}
