import { useCallback } from 'react';
import { formatUnits } from 'viem';
import { clientFor, loadDeployment, readVault } from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
export function VaultValue({ price }: { price?: number }) {
  const resource = useResource(
    useCallback(async () => {
      const deployment = await loadDeployment(133),
        client = clientFor(133);
      if ((await client.getChainId()) !== 133) throw Error('Network mismatch');
      const snapshot = await readVault(133, deployment.vault, client);
      if (snapshot.tokenMismatch) throw Error('Vault token mismatch');
      return [
        Number(formatUnits(snapshot.balanceA!, snapshot.decimalsA)),
        Number(formatUnits(snapshot.balanceB!, snapshot.decimalsB)),
      ];
    }, []),
  );
  return (
    <article className="reference-tile">
      <span>Vault value (USDT) · testnet inventory</span>
      <strong>
        {resource.data && price
          ? (resource.data[0] * price + resource.data[1]).toFixed(2)
          : 'Value unavailable'}
      </strong>
      {resource.error && (
        <p role="alert">
          {resource.error === 'Vault token mismatch'
            ? 'Vault token mismatch: valuation disabled.'
            : 'Vault data unavailable, retrying.'}
        </p>
      )}
      <small>Mainnet mark on test tokens; not real funds or P&L.</small>
    </article>
  );
}
