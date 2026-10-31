import { humanError } from '../lib/errors.js';
import { useState } from 'react';
import type { Address } from 'viem';
import { connectLedger } from './ledger.js';
import { clientFor, loadDeployment } from '../lib/clients.js';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
export function ConnectLedger({
  vault,
  signerFactory = connectLedger,
  readOwner = async (address: Address) =>
    clientFor(133).readContract({
      address,
      abi: vaultAbi,
      functionName: 'owner',
    }),
  onAddress,
}: {
  vault?: Address;
  signerFactory?: typeof connectLedger;
  readOwner?: (vault: Address) => Promise<Address>;
  onAddress?: (address?: Address) => void;
}) {
  const [address, setAddress] = useState<Address>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    setMessage('');
    try {
      const signer = await signerFactory(133);
      let account: Address;
      try {
        account = await signer.address();
      } finally {
        await signer.disconnect();
      }
      setAddress(account);
      onAddress?.(account);
      try {
        const target = vault ?? (await loadDeployment(133)).vault;
        const owner = await readOwner(target);
        setMessage(
          owner.toLowerCase() === account.toLowerCase()
            ? 'Owner ✓'
            : 'Not the vault owner',
        );
      } catch {
        setMessage(
          'Address connected. Vault ownership could not be checked; deploy on 133 first or retry.',
        );
      }
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ledger-connect">
      {address ? (
        <>
          <span title={address}>
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
          <button
            onClick={() => {
              setAddress(undefined);
              setMessage('');
              onAddress?.(undefined);
            }}
          >
            Disconnect
          </button>
        </>
      ) : (
        <button disabled={busy} onClick={() => void connect()}>
          {busy ? 'Connecting…' : 'Connect Ledger'}
        </button>
      )}
      {!('hid' in navigator) && (
        <small>WebHID requires Chrome/Edge over HTTPS (or localhost).</small>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
