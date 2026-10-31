import { useCallback } from 'react';
import { formatUnits } from 'viem';
import { addresses } from '../../../../packages/core/src/addresses.js';
import { erc20Abi } from '../../../../packages/core/src/abi/index.js';
import { clientFor, loadDeployment } from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';
export function VaultValue({ price }: { price?: number }) {
  const resource = useResource(
    useCallback(async () => {
      const deployment = await loadDeployment(133),
        client = clientFor(133);
      if ((await client.getChainId()) !== 133) throw Error('Network mismatch');
      const balances = await Promise.all(
        ['whsk', 'usdt'].map(async (token) => {
          const address = addresses[133][token as 'whsk' | 'usdt'].address;
          const [amount, decimals] = await Promise.all([
            client.readContract({
              address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [deployment.vault],
            }),
            client.readContract({
              address,
              abi: erc20Abi,
              functionName: 'decimals',
            }),
          ]);
          return Number(formatUnits(amount, decimals));
        }),
      );
      return balances;
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
      <small>Mainnet mark on test tokens; not real funds or P&L.</small>
    </article>
  );
}
