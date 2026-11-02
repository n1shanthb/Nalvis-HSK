import {
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { LedgerContext } from '../owner/LedgerContext.js';
import { ConnectLedger } from '../owner/ConnectLedger.js';
import {
  clientFor,
  loadDeployment,
  type DashboardChain,
} from '../lib/clients.js';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
import { useResource } from '../lib/useResource.js';

/** Workspace presentation, not authentication. On-chain records remain public. */
export function WorkspaceAccess({
  chain,
  demo,
  children,
}: {
  chain: DashboardChain;
  demo: boolean;
  children: (publicView: boolean) => ReactNode;
}) {
  const ledger = useContext(LedgerContext);
  const address = ledger?.address;
  const [selection, select] = useState<{
    view: 'nishanth' | 'own';
    wallet?: string;
  }>({ view: 'own' });
  const [started, start] = useState(false);
  useEffect(() => {
    select({ view: 'own', wallet: address });
    start(false);
  }, [address]);
  const owner = useResource(
    useCallback(async () => {
      if (chain !== 177 || demo || !address) return null;
      const deployment = await loadDeployment(chain);
      const client = clientFor(chain);
      if ((await client.getChainId()) !== chain)
        throw Error('RPC chain mismatch');
      const currentOwner = await client.readContract({
        address: deployment.vault,
        abi: vaultAbi,
        functionName: 'owner',
      });
      return {
        wallet: address.toLowerCase(),
        owner: currentOwner.toLowerCase(),
      };
    }, [address, chain, demo]),
  );
  if (chain !== 177 || demo) return children(false);
  const mine =
    address != null &&
    owner.data?.wallet === address.toLowerCase() &&
    owner.data.owner === address.toLowerCase();
  const viewingNishanth =
    selection.view === 'nishanth' && selection.wallet === address;
  if (mine || viewingNishanth)
    return (
      <>
        <aside className="workspace-identity" aria-label="Workspace identity">
          <div>
            <strong>
              {mine ? 'Your Ledger mandate' : 'Nishanth’s Ledger mandate'}
            </strong>
            <span>
              Live mainnet activity · HashKey Chain 177
              {!mine
                ? ' · viewing Nishanth’s agent, not your wallet history'
                : ''}
            </span>
          </div>
          {!mine && (
            <button
              onClick={() => {
                select({ view: 'own', wallet: address });
                start(true);
                window.location.hash = '#/setup';
              }}
            >
              Set your own mandate
            </button>
          )}
          {mine && owner.error && (
            <small>
              Owner read refresh unavailable; showing the last owner
              observation.
            </small>
          )}
        </aside>
        {children(!mine)}
      </>
    );
  return (
    <div className="shell workspace-entry">
      <header>
        <a href="#/home">
          <strong>NALVIS</strong>
        </a>
        <span className="micro-label">MAINNET WORKSPACE</span>
      </header>
      <main id="workspace-main" tabIndex={-1}>
        <p className="eyebrow">LEDGER-GOVERNED AGENTS</p>
        <h1>
          {started || address ? 'Your workspace' : 'Choose your workspace'}
        </h1>
        <p>
          No wallet history or agent activity is loaded until you choose a
          workspace.
        </p>
        <section className="workspace-entry-grid">
          <article className="agent-card">
            <p className="micro-label">REAL AGENT · REAL MAINNET ACTIVITY</p>
            <h2>Nishanth’s Ledger mandate</h2>
            <p>
              Follow the running agent’s decisions, strategy notes, market
              watches and on-chain receipts. No Ledger required to view.
            </p>
            <button
              onClick={() => {
                select({ view: 'nishanth', wallet: address });
                window.location.hash = '#/agent';
              }}
            >
              View Nishanth’s mainnet agent
            </button>
          </article>
          <article className="agent-card">
            <h2>Set your own mandate</h2>
            <p>
              Connect your Ledger to check its workspace. Viewing activity never
              grants authority to sign or trade.
            </p>
            <ConnectLedger chain={chain} />
            {address && (
              <p>
                <code>{address}</code>
              </p>
            )}
            {address && owner.loading && (
              <p role="status">
                Checking the connected Ledger’s vault ownership…
              </p>
            )}
            {address && owner.error && (
              <p role="status">
                Vault ownership could not be checked. No workspace authority is
                assumed.
              </p>
            )}
            {address &&
              owner.data?.wallet === address.toLowerCase() &&
              !mine && (
                <p role="status">
                  No Nalvis vault is configured for this Ledger. Your history is
                  empty. This installation currently serves Nishanth’s deployed
                  vault; a separate owner-controlled vault and agent must be
                  configured before you can set your own mandate.
                </p>
              )}
          </article>
        </section>
        <p className="micro-label">
          Connecting a Ledger selects an account; it is not a private-data
          login. On-chain records and Nishanth’s published activity are public.
        </p>
      </main>
    </div>
  );
}
