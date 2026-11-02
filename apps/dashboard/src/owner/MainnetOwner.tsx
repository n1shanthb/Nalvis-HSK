import { useContext, useState } from 'react';
import { LedgerContext } from './LedgerContext.js';
import {
  decodeFunctionData,
  encodeFunctionData,
  keccak256,
  type Hex,
} from 'viem';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
import { hash } from '../../../../packages/core/src/canonical.js';
import { MainnetMandateForm } from './MainnetMandateForm.js';
import { fieldsFor } from './MandateForm.js';
import { MandateDiff } from './MandateWizard.js';
import { TransactionState } from '../components/DecisionHistory.js';
import {
  connectLedger,
  sendOwnerAction,
  BLIND_SIGNING_WARNING,
} from './ledger.js';
import {
  explorerLink,
  type Deployment,
  type VaultSnapshot,
  type VaultMandate,
} from '../lib/clients.js';

/** Mainnet form preserves the live policy; testnet strategy presets are never applied. */
export function MainnetOwner({
  deployment,
  snapshot,
  reload,
}: {
  deployment: Deployment;
  snapshot: VaultSnapshot;
  reload(): unknown;
}) {
  const ledger = useContext(LedgerContext);
  const [data, setData] = useState(''),
    [review, setReview] = useState<{
      data: Hex;
      context: Hex;
      mandate?: VaultMandate;
    }>(),
    [summary, setSummary] = useState(''),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(''),
    [submitted, setSubmitted] = useState<Hex>();
  const context = hash({
    vault: deployment.vault,
    owner: snapshot.owner,
    mandate: snapshot.mandate,
    paused: snapshot.paused,
    decimalsA: snapshot.decimalsA,
    decimalsB: snapshot.decimalsB,
    tokenMismatch: !!snapshot.tokenMismatch,
  });
  const stale = review !== undefined && review.context !== context;
  function edit() {
    setReview(undefined);
    setAck(false);
    setResult('');
  }
  function prepare(next: string) {
    next = next.replace(/\s/g, '');
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
        throw Error(
          'Paste the complete 0x hex value, or load the calldata text file below.',
        );
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
      setReview({
        data: next as Hex,
        context,
        ...(decoded.functionName === 'setMandate'
          ? { mandate: decoded.args[0] }
          : {}),
      });
    } catch (error) {
      setResult(
        `Cannot review this calldata: ${error instanceof Error ? error.message : 'Invalid data'}`,
      );
    }
  }
  async function sign() {
    if (!review || !ack || busy || stale) return;
    setBusy(true);
    setResult('');
    try {
      const signer = await connectLedger(177, ledger?.accountIndex ?? 0);
      const hash = await sendOwnerAction({
        chainId: 177,
        vault: deployment.vault,
        owner: deployment.owner,
        data: review.data,
        signer,
      });
      setResult(`Submitted: ${hash}. Check mined receipt before continuing.`);
      setSubmitted(hash);
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
    <section className="mainnet-owner-review" aria-label="Mainnet owner review">
      <h2>Mainnet owner action</h2>
      <p>
        Chain 177 · Real funds · Destination {deployment.vault} · Value 0 HSK
      </p>
      <p>{BLIND_SIGNING_WARNING}</p>
      <MainnetMandateForm
        deployment={deployment}
        snapshot={snapshot}
        busy={busy}
        onEdit={edit}
        onReview={prepare}
      />
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
      <details className="technical-details">
        <summary>Advanced: import generated calldata</summary>
        <p>
          Optional for custom policy initialization or withdrawals. The mandate
          form above generates its own calldata.
        </p>
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
        <label>
          Load generated calldata file
          <input
            type="file"
            accept=".txt"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              setData(text.trim());
              prepare(text);
            }}
          />
        </label>
        <button disabled={busy} onClick={() => prepare(data)}>
          Review calldata
        </button>
      </details>
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
          <h3>Review before signing</h3>
          {stale && (
            <p role="alert">
              The on-chain mandate or configuration changed. Review your form
              again before signing.
            </p>
          )}
          {review.mandate && (
            <MandateDiff
              current={fieldsFor(snapshot)}
              proposed={fieldsFor({ ...snapshot, mandate: review.mandate })}
            />
          )}
          <details>
            <summary>Exact raw arguments</summary>
            <pre>{summary}</pre>
          </details>
          <p>
            Calldata hash: <code>{keccak256(review.data)}</code>
          </p>
          <details>
            <summary>Full calldata</summary>
            <code>{review.data}</code>
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
          <button disabled={!ack || busy || stale} onClick={() => void sign()}>
            {busy ? 'Awaiting Ledger…' : 'Sign reviewed action on Ledger'}
          </button>
        </>
      )}
      <p role="status">{result}</p>
      {submitted && (
        <>
          <a
            href={explorerLink(177, 'tx', submitted)}
            target="_blank"
            rel="noreferrer"
          >
            View submitted transaction ↗
          </a>
          <TransactionState key={submitted} hash={submitted} chain={177} />
        </>
      )}
    </section>
  );
}
