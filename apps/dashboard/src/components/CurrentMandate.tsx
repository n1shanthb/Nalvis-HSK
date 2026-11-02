import { useCallback } from 'react';
import {
  loadDeployment,
  readVault,
  type DashboardChain,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
import { MandateDetails } from '../views/Mandate.js';
export function CurrentMandate({ chain }: { chain: DashboardChain }) {
  const resource = useResource(
    useCallback(async () => {
      const deployment = await loadDeployment(chain);
      return readVault(chain, deployment.vault, deployment.router);
    }, [chain]),
  );
  return (
    <details className="secondary-section">
      <summary>Current mandate · chain {chain}</summary>
      {resource.error && (
        <p role="status">
          Mandate read unavailable.{' '}
          {resource.data && 'Showing last successful read; refresh failed.'}
        </p>
      )}
      {resource.data ? (
        <MandateDetails snapshot={resource.data} />
      ) : (
        <p>
          {resource.loading
            ? 'Reading mandate…'
            : 'Mandate unavailable; no authority assumed.'}
        </p>
      )}
    </details>
  );
}
