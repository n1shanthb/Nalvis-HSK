import { useCallback } from 'react';
import { formatUnits } from 'viem';
import { addresses } from '../../../../packages/core/src/addresses.js';
import {
  loadDeployment,
  readVault,
  explorerLink,
  displayTime,
  type DashboardChain,
  type VaultSnapshot,
  type Deployment,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
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
  const exposurePct = (m.maxExposureBps / 100).toFixed(1);
  return (
    <div className="mandate-details-wrapper">
      <div className="mandate-visual-caps">
        <div className="cap-card">
          <div className="cap-header">
            <span>MAX EXPOSURE CAP</span>
            <strong>{m.maxExposureBps} BPS ({exposurePct}%)</strong>
          </div>
          <div className="cap-bar-track">
            <div
              className="cap-bar-fill exposure-fill"
              style={{ width: `${Math.min(100, Math.max(0, m.maxExposureBps / 100))}%` }}
            />
          </div>
          <small>Strict risk bound: WHSK/total pair value ceiling</small>
        </div>
        <div className="cap-card">
          <div className="cap-header">
            <span>MAX SLIPPAGE TOLERANCE</span>
            <strong>{m.maxSlippageBps} BPS ({(m.maxSlippageBps / 100).toFixed(2)}%)</strong>
          </div>
          <div className="cap-bar-track">
            <div
              className="cap-bar-fill slippage-fill"
              style={{ width: `${Math.min(100, Math.max(0, m.maxSlippageBps))}%` }}
            />
          </div>
          <small>Hard protocol-level cap: max 100 bps (1.00%)</small>
        </div>
      </div>
      <dl>
        {Object.entries({
          Owner: snapshot.owner,
          Agent: m.agent,
          Expiry: displayTime(m.expiry),
          'WHSK per trade': formatUnits(m.maxTradeInA, snapshot.decimalsA),
          'USDT per trade': formatUnits(m.maxTradeInB, snapshot.decimalsB),
          'USDT per UTC day': formatUnits(m.maxDailyInB, snapshot.decimalsB),
          'Exposure cap (bps)': m.maxExposureBps,
          'Slippage cap (bps)': m.maxSlippageBps,
          'Minimum interval (s)': String(m.minIntervalSec),
          'Policy hash': m.policyHash,
          Paused: String(snapshot.paused),
          'Read block': String(snapshot.blockNumber),
        }).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
export function MandateView({
  chain,
  onOwner,
}: {
  chain: DashboardChain;
  onOwner?: (d: Deployment, s: VaultSnapshot) => React.ReactNode;
}) {
  const resource = useResource(
    useCallback(async () => {
      const deployment = await loadDeployment(chain);
      return { deployment, snapshot: await readVault(chain, deployment.vault) };
    }, [chain]),
  );
  const cfg = addresses[chain === 133 ? 133 : 177];
  return (
    <section>
      <p className="eyebrow">01 / AUTHORITY</p>
      <h2>The signed mandate</h2>
      <p>
        Execution limits set by the owner. Every trade stays within this
        envelope.
      </p>
      {resource.loading && <p role="status">Reading deployment and mandate…</p>}
      {resource.error && (
        <p role="status">
          Mandate unavailable — {resource.error}. No verified network deployment
          is currently listed.
        </p>
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
          {onOwner?.(resource.data.deployment, resource.data.snapshot)}
        </>
      )}
      <h3>Verified network contracts</h3>
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
    </section>
  );
}
