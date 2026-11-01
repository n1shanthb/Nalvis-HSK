import { humanError } from '../lib/errors.js';
import { LedgerContext } from './LedgerContext.js';
import { useContext, useState } from 'react';
import type { Address } from 'viem';
import { connectLedger } from './ledger.js';
import { clientFor, loadDeployment } from '../lib/clients.js';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
export function ConnectLedger({
  chain = 133,
  vault,
  signerFactory = connectLedger,
  readOwner = async (address: Address) =>
    clientFor(chain).readContract({
      address,
      abi: vaultAbi,
      functionName: 'owner',
    }),
  onAddress,
}: {
  chain?: 133 | 177 | 31337;
  vault?: Address;
  signerFactory?: typeof connectLedger;
  readOwner?: (vault: Address) => Promise<Address>;
  onAddress?: (address?: Address) => void;
}) {
  const shared = useContext(LedgerContext);
  const [localAddress, setLocalAddress] = useState<Address>();
  const address = shared ? shared.address : localAddress;
  const setAddress = shared ? shared.setAddress : setLocalAddress;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    setMessage('');
    try {
      const signer = await signerFactory(chain);
      let account: Address;
      try {
        account = await signer.address();
      } finally {
        await signer.disconnect();
      }
      setAddress(account);
      onAddress?.(account);
      try {
        const target = vault ?? (await loadDeployment(chain)).vault;
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
