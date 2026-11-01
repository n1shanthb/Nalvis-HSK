import { useState } from 'react';
import {
  decodeFunctionData,
  encodeFunctionData,
  keccak256,
  type Hex,
} from 'viem';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
import {
  connectLedger,
  sendOwnerAction,
  BLIND_SIGNING_WARNING,
} from './ledger.js';
import type { Deployment, VaultSnapshot } from '../lib/clients.js';

/** Mainnet uses exact generated policy calldata; the testnet preset wizard is intentionally excluded. */
export function MainnetOwner({
  deployment,
  snapshot,
  reload,
}: {
  deployment: Deployment;
  snapshot: VaultSnapshot;
  reload(): unknown;
}) {
  const [data, setData] = useState(''),
    [review, setReview] = useState<Hex>(),
    [summary, setSummary] = useState(''),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  function prepare(next: string) {
    setReview(undefined);
    setAck(false);
    setResult('');
    try {
      if (
        snapshot.tokenMismatch ||
        snapshot.owner.toLowerCase() !== deployment.owner.toLowerCase()
      )
        throw Error('Vault configuration mismatch');
      if (!/^0x(?:[\da-fA-F]{2})+$/.test(next))
        throw Error('Valid calldata required');
      const decoded = decodeFunctionData({ abi: vaultAbi, data: next as Hex });
      if (
        !['setMandate', 'pause', 'unpause', 'revoke', 'withdraw'].includes(
          decoded.functionName,
        )
      )
        throw Error('Unsupported owner action');
      setSummary(
        JSON.stringify(
          decoded,
          (_, v) => (typeof v === 'bigint' ? String(v) : v),
          2,
        ),
      );
      setReview(next as Hex);
    } catch {
      setResult('Cannot review this calldata');
    }
  }
  async function sign() {
    if (!review || !ack) return;
    setBusy(true);
    setResult('');
    try {
      const signer = await connectLedger(177);
      const hash = await sendOwnerAction({
        chainId: 177,
        vault: deployment.vault,
        owner: deployment.owner,
        data: review,
        signer,
      });
      setResult(`Submitted: ${hash}. Check mined receipt before continuing.`);
      setReview(undefined);
      setAck(false);
      reload();
    } catch {
      setResult(
        'Owner action failed or cancelled. No success is assumed; inspect the transaction before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (import.meta.env.VITE_MAINNET_EXECUTION !== 'true')
    return <p>Mainnet owner actions disabled in this build.</p>;
  return (
    <section aria-label="Mainnet owner review">
      <h2>Mainnet owner action</h2>
      <p>
        Chain 177 · Real funds · Destination {deployment.vault} · Value 0 HSK
      </p>
      <p>{BLIND_SIGNING_WARNING}</p>
      <details>
        <summary>Current on-chain mandate and token units</summary>
        <p>
          WHSK decimals: {snapshot.decimalsA} · USDT decimals:{' '}
          {snapshot.decimalsB}
        </p>
        <pre>
          {JSON.stringify(
            snapshot.mandate,
            (_, value) => (typeof value === 'bigint' ? String(value) : value),
            2,
          )}
        </pre>
      </details>
      <label>
        Exact generated mandate or withdrawal calldata
        <textarea
          value={data}
          disabled={busy}
          onChange={(e) => {
            setData(e.target.value);
            setReview(undefined);
            setAck(false);
          }}
        />
      </label>
      <button disabled={busy} onClick={() => prepare(data)}>
        Review calldata
      </button>
      {(['pause', 'unpause', 'revoke'] as const).map((functionName) => (
        <button
          key={functionName}
          disabled={busy}
          onClick={() =>
            prepare(encodeFunctionData({ abi: vaultAbi, functionName }))
          }
        >
          Review {functionName}
        </button>
      ))}
      {review && (
        <>
          <pre>{summary}</pre>
          <p>
            Calldata hash: <code>{keccak256(review)}</code>
          </p>
          <details>
            <summary>Full calldata</summary>
            <code>{review}</code>
          </details>
          <label>
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed chain, destination, policy hash, expiry, raw limits and
            all arguments for real funds.
          </label>
          <button disabled={!ack || busy} onClick={() => void sign()}>
            {busy ? 'Awaiting Ledger…' : 'Sign reviewed action on Ledger'}
          </button>
        </>
      )}
      <p role="status">{result}</p>
    </section>
  );
}
