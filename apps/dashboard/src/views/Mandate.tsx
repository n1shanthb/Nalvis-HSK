import { ConnectLedger } from '../owner/ConnectLedger.js';
import { LimitChart } from '../components/charts/LimitChart.js';
import { Portfolio } from './Portfolio.js';
import { useCallback, useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { addresses } from '../../../../packages/core/src/addresses.js';
import {
  clientFor,
  DeploymentError,
  loadDeployment,
  readVault,
  explorerLink,
  displayTime,
  type DashboardChain,
  type VaultSnapshot,
  type Deployment,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
import { readChartRisk } from '../lib/chart-data.js';
export function ContractLink({
  chain,
  value,
}: {
  chain: number;
  value: string;
}) {
  const href = explorerLink(chain, 'address', value);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {value} ↗
    </a>
  ) : (
    <code>{value}</code>
  );
}
export function MandateDetails({ snapshot }: { snapshot: VaultSnapshot }) {
  const m = snapshot.mandate;
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Number(m.expiry) - now);
  return (
    <>
      <div className="metrics">
        <article>
          <span>Mandate countdown</span>
          <strong>
            {remaining
              ? `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m ${remaining % 60}s`
              : 'Expired'}
          </strong>
        </article>
        <article>
          <span>Slippage ceiling</span>
          <strong>{m.maxSlippageBps} bps</strong>
          <progress max={100} value={m.maxSlippageBps} />
        </article>
      </div>
      {snapshot.tokenMismatch && (
        <p role="alert">
          Vault token mismatch: tokenA/tokenB differ from the documented
          WHSK/USDT pair. Check the deployment before proceeding.
        </p>
      )}
      <div className="mandate-groups">
        {[
          {
            title: 'Authority & expiry',
            values: {
              Owner: snapshot.owner,
              'Vault pending owner': snapshot.pendingOwner,
              'Router owner': snapshot.routerOwner,
              'Router pending owner': snapshot.routerPendingOwner,
              Agent: m.agent,
              Expiry: displayTime(m.expiry),
            },
          },
          {
            title: 'Trade & daily limits',
            values: {
              'WHSK per trade': formatUnits(m.maxTradeInA, snapshot.decimalsA),
              'USDT per trade': formatUnits(m.maxTradeInB, snapshot.decimalsB),
              'USDT rolling 24-hour cap': formatUnits(
                m.maxDailyInB,
                snapshot.decimalsB,
              ),
            },
          },
          {
            title: 'Execution controls',
            values: {
              'Exposure cap (bps)': m.maxExposureBps,
              'Slippage cap (bps)': m.maxSlippageBps,
              'Drawdown cap (bps)': m.maxDrawdownBps,
              'Minimum interval (s)': String(m.minIntervalSec),
              Paused: String(snapshot.paused),
            },
          },
        ].map((group) => (
          <article className="agent-card" key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {Object.entries(group.values).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <details className="technical-details">
        <summary>Policy commitment & read block</summary>
        <dl>
          <div>
            <dt>Vault policy hash</dt>
            <dd>
              <code>{m.policyHash}</code>
            </dd>
          </div>
          <div>
            <dt>Router policy hash</dt>
            <dd>
              <code>{snapshot.routerPolicyHash}</code>
            </dd>
          </div>
          <div>
            <dt>Vault/router policy match</dt>
            <dd>
              {snapshot.policiesMatch === undefined
                ? 'Unavailable'
                : snapshot.policiesMatch
                  ? 'Yes'
                  : 'NO'}
            </dd>
          </div>
          <div>
            <dt>Read block</dt>
            <dd>{String(snapshot.blockNumber)}</dd>
          </div>
        </dl>
      </details>
    </>
  );
}
export function MandateView({
  chain,
  setup = false,
  onOwner,
}: {
  chain: DashboardChain;
  setup?: boolean;
  onOwner?: (
    d: Deployment,
    s: VaultSnapshot,
    reload: () => Promise<void>,
  ) => React.ReactNode;
}) {
  const resource = useResource(
    useCallback(async () => {
      const deployment = await loadDeployment(chain);
      const snapshot = await readVault(
        chain,
        deployment.vault,
        deployment.router,
      );
      const risk = await readChartRisk(
        clientFor(chain),
        deployment.vault,
        snapshot.blockNumber,
        snapshot.decimalsB,
      ).catch(() => undefined);
      return { deployment, snapshot, risk };
    }, [chain]),
  );
  const cfg = addresses[chain === 133 ? 133 : 177];
  return (
    <section>
      <p className="eyebrow">{setup ? 'SET MANDATE' : 'MANDATE'}</p>
      <h1>
        {setup ? 'Define your execution boundaries' : 'The signed mandate'}
      </h1>
      <p>
        Execution limits set by the owner. Every trade stays within this
        envelope.
      </p>
      {setup && !resource.data && (
        <ol className="wizard-steps" aria-label="Mandate setup stages">
          {[
            'Connect',
            'Preset',
            'Tune limits',
            'Compare',
            'Review & sign',
            'First decision',
            'Verify',
          ].map((label, i) => (
            <li key={label} aria-current={i === 0 ? 'step' : undefined}>
              {String(i + 1).padStart(2, '0')} {label}
            </li>
          ))}
        </ol>
      )}
      <div className="mandate-connection">
        <ConnectLedger />
        <span className="micro-label">Testnet 133 · Ledger blind signing</span>
      </div>
      {resource.loading && (
        <p className="skeleton" role="status">
          Reading deployment and mandate…
        </p>
      )}
      {resource.error && (
        <p role="status">
          {resource.data ? 'Data stale, retrying. ' : ''}
          {resource.cause instanceof DeploymentError
            ? resource.cause.message
            : 'RPC unavailable, retrying'}
        </p>
      )}
      {!resource.data &&
        resource.cause instanceof DeploymentError &&
        resource.cause.kind === 'missing' && (
          <div role="status" className="agent-card">
            <h3>Not deployed on 133 yet</h3>
            <p>
              The vault deployment could not be loaded or verified. Follow the
              human testnet bootstrap:
            </p>
            <ol>
              <li>
                Create separate deployer and agent testnet wallets; connect the
                Ledger owner.
              </li>
              <li>Claim test HSK, wrap it and acquire test USDT.</li>
              <li>
                Deploy and fund on chain 133, then verify owners and deployment
                receipts.
              </li>
              <li>
                Build the mandate calldata and review it on Ledger with blind
                signing enabled.
              </li>
            </ol>
            <p>
              See scripts/testnet-bootstrap.md. No keys or transactions are
              handled by Codex.
            </p>
          </div>
        )}
      {resource.data && (
        <>
          <h3>deployments/{chain}.json</h3>
          <p>
            Vault{' '}
            <ContractLink
              chain={chain}
              value={resource.data.deployment.vault}
            />
          </p>
          <p>
            Receipt router{' '}
            <ContractLink
              chain={chain}
              value={resource.data.deployment.router}
            />
          </p>
          <MandateDetails snapshot={resource.data.snapshot} />
          {onOwner?.(
            resource.data.deployment,
            resource.data.snapshot,
            resource.reload,
          )}
        </>
      )}
      <LimitChart
        mandate={
          resource.data
            ? {
                ...resource.data.snapshot.mandate,
                minIntervalSec: Number(
                  resource.data.snapshot.mandate.minIntervalSec,
                ),
              }
            : undefined
        }
        at={resource.data?.risk?.at}
        decimalsB={resource.data?.snapshot.decimalsB}
        dailySpentB={resource.data?.risk?.dailySpentB}
        lastTradeAt={resource.data?.risk?.lastTradeAt}
      />
      <Portfolio chain={chain} />
      <details className="technical-details">
        <summary>Verified network contracts</summary>
        <dl>
          {Object.entries(cfg)
            .filter(([key]) =>
              ['primaryPool', 'quoterV2', 'whsk', 'usdt'].includes(key),
            )
            .map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <ContractLink
                    chain={chain === 31337 ? 177 : chain}
                    value={value.address}
                  />
                </dd>
              </div>
            ))}
        </dl>
      </details>
    </section>
  );
}
