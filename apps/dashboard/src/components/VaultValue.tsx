import { useCallback } from 'react';
import { formatUnits } from 'viem';
import {
  clientFor,
  loadDeployment,
  readVault,
  type DashboardChain,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
export function VaultValue({
  price,
  chain = 133,
}: {
  price?: number;
  chain?: DashboardChain;
}) {
  const resource = useResource(
    useCallback(async () => {
      const deployment = await loadDeployment(chain),
        client = clientFor(chain);
      if ((await client.getChainId()) !== chain)
        throw Error('Network mismatch');
      const snapshot = await readVault(chain, deployment.vault, client);
      if (snapshot.tokenMismatch) throw Error('Vault token mismatch');
      return [
        Number(formatUnits(snapshot.balanceA!, snapshot.decimalsA)),
        Number(formatUnits(snapshot.balanceB!, snapshot.decimalsB)),
      ];
    }, [chain]),
  );
  return (
    <article className="reference-tile">
      <span>
        Vault value (USDT) ·{' '}
        {chain === 177 ? 'mainnet inventory' : 'testnet inventory'}
      </span>
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
      <small>
        {chain === 177
          ? 'Pool mark on mainnet inventory; unrealised value, not realised P&L.'
          : 'Mainnet mark on test tokens; not real funds or P&L.'}
      </small>
    </article>
  );
}
