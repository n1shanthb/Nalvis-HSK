import { useEffect, useState } from 'react';
import { encodeFunctionData, keccak256, type Address, type Hex } from 'viem';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
import {
  fieldsFor,
  validateMandate,
  type MandateFields,
} from './MandateForm.js';
import { ConnectLedger } from './ConnectLedger.js';
import {
  assertOwnerChain,
  BLIND_SIGNING_WARNING,
  connectLedger,
  sendOwnerAction,
} from './ledger.js';
import { clientFor, explorerLink, type VaultSnapshot } from '../lib/clients.js';
import { useReceiptEvents } from '../agent/useReceiptEvents.js';
export function wizardCalldata(fields: MandateFields, snapshot: VaultSnapshot) {
  return encodeFunctionData({
    abi: vaultAbi,
    functionName: 'setMandate',
    args: [validateMandate(fields, snapshot)],
  });
}
export function MandateDiff({
  current,
  proposed,
}: {
  current: MandateFields;
  proposed: MandateFields;
}) {
  return (
    <div className="table-scroll">
      <table>
        <caption>Current vs Proposed</caption>
        <thead>
          <tr>
            <th>Field</th>
            <th>Current</th>
            <th>Proposed</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(current) as (keyof MandateFields)[]).map((key) => (
            <tr
              key={key}
              className={current[key] !== proposed[key] ? 'changed' : undefined}
              data-changed={current[key] !== proposed[key]}
            >
              <th>{key}</th>
              <td>{current[key]}</td>
              <td>{proposed[key]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
// UI defaults, expressed in human token units. Always reviewed and validated before signing.
const presets = {
  Conservative: ['1', '25', '100', '6000', '30', '1000', '600'],
  Balanced: ['2', '100', '500', '8000', '50', '2000', '300'],
  Patient: ['1', '50', '200', '7000', '40', '1500', '1800'],
} as const;
const controls = [
  ['maxTradeInA', 'WHSK per trade', 0.1, 100, 0.1, 1],
  ['maxTradeInB', 'USDT per trade', 1, 1000, 1, 1],
  ['maxDailyInB', 'USDT per UTC day', 1, 5000, 1, 1],
  ['maxExposureBps', 'Exposure (%)', 0, 100, 1, 100],
  ['maxSlippageBps', 'Slippage cap (bps)', 1, 100, 1, 1],
  ['maxDrawdownBps', 'Drawdown (%)', 0, 100, 1, 100],
  ['minIntervalSec', 'Minimum interval (seconds)', 0, 86400, 30, 1],
] as const;
export function MandateWizard({
  chain,
  vault,
  snapshot,
  previewOnly = false,
}: {
  chain: number;
  vault: Address;
  snapshot: VaultSnapshot;
  previewOnly?: boolean;
}) {
  const [step, setStep] = useState(0),
    [fields, setFields] = useState(() => fieldsFor(snapshot)),
    [days, setDays] = useState(7),
    [account, setAccount] = useState<Address>();
  const [review, setReview] = useState<{ data: Hex; context: string }>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState<Hex>(),
    [confirmedBlock, setConfirmedBlock] = useState<bigint>();
  const context = JSON.stringify(
    { chain, vault, owner: snapshot.owner, mandate: snapshot.mandate },
    (_, v) => (typeof v === 'bigint' ? String(v) : v),
  );
  const receipts = useReceiptEvents(
    133,
    confirmedBlock !== undefined && !previewOnly,
  );
  useEffect(() => {
    if (
      confirmedBlock &&
      receipts.data?.some((l) => l.blockNumber >= confirmedBlock)
    )
      setStep(6);
  }, [confirmedBlock, receipts.data]);
  function nextReview() {
    setMessage('');
    setReview(undefined);
    try {
      assertOwnerChain(chain);
      setReview({ data: wizardCalldata(fields, snapshot), context });
      setStep(4);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Review the mandate values.');
    }
  }
  async function sign() {
    if (!review || busy || review.context !== context || previewOnly) return;
    setBusy(true);
    setMessage('');
    try {
      assertOwnerChain(chain);
      const tx = await sendOwnerAction({
        chainId: chain,
        vault,
        owner: snapshot.owner,
        data: review.data,
        signer: await connectLedger(chain),
      });
      setHash(tx);
      setMessage('Submitted. Waiting for confirmation…');
      const receipt = await clientFor(133).waitForTransactionReceipt({
        hash: tx,
      });
      if (receipt.status !== 'success')
        throw Error(
          'Transaction reverted. Refresh the mandate and build a new review.',
        );
      setConfirmedBlock(receipt.blockNumber);
      setStep(5);
      setMessage('Mandate confirmed');
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Ledger signing failed. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (chain !== 133)
    return <p role="alert">Mandate wizard requires chain 133.</p>;
  return (
    <article className="mandate-wizard agent-card">
      <h3>Set your mandate</h3>
      <ol className="wizard-steps">
        {[
          'Connect',
          'Preset',
          'Tune limits',
          'Compare',
          'Review & sign',
          'First decision',
          'Verify',
        ].map((s, i) => (
          <li key={s} aria-current={step === i ? 'step' : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {previewOnly && <p>Recorded demo preview. No signing or transactions.</p>}
      {step === 0 && (
        <>
          <ConnectLedger vault={vault} onAddress={setAccount} />
          <p>Unlock Ledger and open the Ethereum app.</p>
          <button
            disabled={
              !previewOnly &&
              account?.toLowerCase() !== snapshot.owner.toLowerCase()
            }
            onClick={() => setStep(1)}
          >
            Choose a preset
          </button>
        </>
      )}
      {step === 1 && (
        <div className="preset-grid">
          {Object.entries(presets).map(([name, values]) => (
            <button
              key={name}
              onClick={() => {
                setFields({
                  ...fields,
                  ...Object.fromEntries(
                    controls.map(([key], i) => [key, values[i]]),
                  ),
                  expiry: String(Math.floor(Date.now() / 1000) + days * 86400),
                });
                setStep(2);
              }}
            >
              {name}
              <small>
                {values[1]} USDT per trade · {values[2]} USDT/day
              </small>
            </button>
          ))}
        </div>
      )}
      {step === 2 && (
        <>
          <label>
            Agent address
            <input
              value={fields.agent}
              onChange={(e) => setFields({ ...fields, agent: e.target.value })}
            />
          </label>
          {controls.map(([key, label, min, max, increment, scale]) => (
            <label key={key}>
              {label}
              <output>{Number(fields[key]) / scale}</output>
              <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={increment}
                value={Number(fields[key]) / scale}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    [key]: String(
                      Math.round(
                        Math.max(min, Math.min(max, Number(e.target.value))) *
                          scale,
                      ),
                    ),
                  })
                }
              />
            </label>
          ))}
          <label>
            Expiry (days)<output>{days}</output>
            <input
              aria-label="Expiry (days)"
              type="range"
              min={1}
              max={30}
              value={days}
              onChange={(e) => {
                const n = Math.max(1, Math.min(30, Number(e.target.value)));
                setDays(n);
                setFields({
                  ...fields,
                  expiry: String(Math.floor(Date.now() / 1000) + n * 86400),
                });
              }}
            />
          </label>
          <label>
            Policy hash
            <input
              value={fields.policyHash}
              onChange={(e) =>
                setFields({ ...fields, policyHash: e.target.value })
              }
            />
          </label>
          <button onClick={() => setStep(3)}>
            Compare current and proposed
          </button>
        </>
      )}
      {step === 3 && (
        <>
          <MandateDiff current={fieldsFor(snapshot)} proposed={fields} />
          <button onClick={nextReview}>Build Ledger review</button>
        </>
      )}
      {step === 4 && review && (
        <>
          <p>{BLIND_SIGNING_WARNING}</p>
          <p>
            Verify the destination {vault}, chain 133, value 0 HSK, agent,
            expiry and every cap. Reject if your device cannot show the calldata
            hash.
          </p>
          <p>
            Calldata hash <code>{keccak256(review.data)}</code>
          </p>
          <MandateDiff current={fieldsFor(snapshot)} proposed={fields} />
          <details>
            <summary>Exact mandate calldata</summary>
            <code>{review.data}</code>
          </details>
          <button
            disabled={busy || previewOnly || review.context !== context}
            onClick={() => void sign()}
          >
            Review & sign on Ledger
          </button>
          {review.context !== context && (
            <p>Vault state changed. Build a fresh review.</p>
          )}
        </>
      )}
      {step === 5 && (
        <>
          <h4>Waiting for first agent decision</h4>
          <p>Polling Receipt events on the vault every 30 seconds.</p>
        </>
      )}
      {step === 6 && <p>First agent receipt observed.</p>}
      {hash && <a href={explorerLink(133, 'tx', hash)}>Transaction {hash} ↗</a>}
      {step >= 5 && <a href="#/verify">Open Verify</a>}
      {step > 0 && step < 5 && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setReview(undefined);
            setStep(step - 1);
          }}
        >
          Back
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </article>
  );
}
