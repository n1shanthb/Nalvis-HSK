import { useState, type FormEvent } from 'react';
import { encodeFunctionData, zeroAddress, zeroHash, parseUnits } from 'viem';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
import { fieldsFor, validateMandate } from './MandateForm.js';
import {
  displayTime,
  type Deployment,
  type VaultSnapshot,
} from '../lib/clients.js';

/** Display percentages; encode exact basis points without rounding or clamping. */
export function percentBps(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw Error('Percentages support at most two decimal places.');
  const result = parseUnits(value, 2);
  if (result > 10000n) throw Error('Percentages must be between 0 and 100.');
  return String(result);
}
export const expiryInput = (seconds: string) => {
  const milliseconds = Number(seconds) * 1000 + 19800000;
  return Number(seconds) > 0 &&
    Number.isFinite(milliseconds) &&
    milliseconds <= 8640000000000000
    ? new Date(milliseconds).toISOString().slice(0, 19)
    : '';
};
export function expirySeconds(value: string) {
  const at = Date.parse(`${value}+05:30`);
  return Number.isFinite(at) ? String(Math.floor(at / 1000)) : '';
}

export function MainnetMandateForm({
  snapshot,
  deployment,
  busy,
  onEdit,
  onReview,
}: {
  snapshot: VaultSnapshot;
  deployment: Deployment;
  busy: boolean;
  onEdit(): void;
  onReview(data: `0x${string}`): void;
}) {
  const initial = () => {
    const f = fieldsFor(snapshot);
    return {
      ...f,
      agent: f.agent === zeroAddress ? deployment.agent : f.agent,
    };
  };
  const [fields, setFields] = useState(initial);
  const [exposure, setExposure] = useState(
    String(snapshot.mandate.maxExposureBps / 100),
  );
  const [slippage, setSlippage] = useState(
    String(snapshot.mandate.maxSlippageBps / 100),
  );
  const [drawdown, setDrawdown] = useState(
    String(snapshot.mandate.maxDrawdownBps / 100),
  );
  const [error, setError] = useState('');
  const activeAgent =
    snapshot.mandate.agent === zeroAddress
      ? deployment.agent
      : snapshot.mandate.agent;
  const edit = () => {
    onEdit();
    setError('');
  };
  function review(event: FormEvent) {
    event.preventDefault();
    edit();
    try {
      if (snapshot.tokenMismatch)
        throw Error(
          'Vault token configuration does not match the verified pair.',
        );
      if (snapshot.mandate.policyHash === zeroHash)
        throw Error(
          'A reviewed keeper policy must be configured before creating the first mandate.',
        );
      const slip = percentBps(slippage);
      if (BigInt(slip) < 1n || BigInt(slip) > 100n)
        throw Error('Slippage must be between 0.01% and 1%.');
      const mandate = validateMandate(
        {
          ...fields,
          agent: activeAgent,
          policyHash: snapshot.mandate.policyHash,
          maxExposureBps: percentBps(exposure),
          maxSlippageBps: slip,
          maxDrawdownBps: percentBps(drawdown),
        },
        snapshot,
      );
      onReview(
        encodeFunctionData({
          abi: vaultAbi,
          functionName: 'setMandate',
          args: [mandate],
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the mandate fields.');
    }
  }
  return (
    <form
      className="mainnet-mandate-form"
      onSubmit={review}
      aria-label="Edit mainnet mandate"
    >
      <h3>Edit your mandate</h3>
      <p>
        Start with your current limits. Review the changes, then approve once on
        your selected Ledger account. No calldata to paste.
      </p>
      <fieldset disabled={busy}>
        <legend>Trade and daily limits</legend>
        <div className="mandate-form-grid">
          {(
            [
              ['maxTradeInA', 'WHSK per trade'],
              ['maxTradeInB', 'USDT per trade'],
              ['maxDailyInB', 'USDT rolling 24-hour cap'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required
                inputMode="decimal"
                value={fields[key]}
                onChange={(e) => {
                  edit();
                  setFields({ ...fields, [key]: e.target.value });
                }}
              />
            </label>
          ))}
        </div>
        <p className="muted">
          Amounts use token units, not raw integers. WHSK: {snapshot.decimalsA}{' '}
          decimals · USDT: {snapshot.decimalsB} decimals.
        </p>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Risk and timing</legend>
        <div className="mandate-form-grid">
          <label>
            Maximum WHSK exposure (%)
            <input
              required
              inputMode="decimal"
              value={exposure}
              onChange={(e) => {
                edit();
                setExposure(e.target.value);
              }}
            />
          </label>
          <label>
            Maximum slippage (%)
            <input
              aria-label="Maximum slippage (%)"
              aria-describedby="mainnet-slippage-help"
              required
              inputMode="decimal"
              value={slippage}
              onChange={(e) => {
                edit();
                setSlippage(e.target.value);
              }}
            />
            <small id="mainnet-slippage-help">
              Contract ceiling: 1% (100 bps).
            </small>
          </label>
          <label>
            Maximum drawdown (%)
            <input
              required
              inputMode="decimal"
              value={drawdown}
              onChange={(e) => {
                edit();
                setDrawdown(e.target.value);
              }}
            />
          </label>
          <label>
            Minimum interval (seconds)
            <input
              required
              inputMode="numeric"
              value={fields.minIntervalSec}
              onChange={(e) => {
                edit();
                setFields({ ...fields, minIntervalSec: e.target.value });
              }}
            />
          </label>
          <label>
            Expiry (IST)
            <input
              required
              type="datetime-local"
              step="1"
              value={expiryInput(fields.expiry)}
              onChange={(e) => {
                edit();
                setFields({ ...fields, expiry: expirySeconds(e.target.value) });
              }}
            />
          </label>
        </div>
        <div className="action-bar">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              edit();
              setFields({
                ...fields,
                expiry: String(Math.floor(Date.now() / 1000) + 86400),
              });
            }}
          >
            Valid for 24 hours
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              edit();
              setFields({
                ...fields,
                expiry: String(Math.floor(Date.now() / 1000) + 604800),
              });
            }}
          >
            Valid for 7 days
          </button>
        </div>
        {fields.expiry && <p>Expires {displayTime(Number(fields.expiry))}.</p>}
      </fieldset>
      <details className="technical-details">
        <summary>Agent and strategy policy</summary>
        <p>
          Preserved from the current deployment and mandate. Changing limits
          does not replace the keeper's strategy policy.
        </p>
        <dl>
          <dt>Agent</dt>
          <dd>
            <code>{activeAgent}</code>
          </dd>
          <dt>Policy commitment</dt>
          <dd>
            <code>{snapshot.mandate.policyHash}</code>
          </dd>
        </dl>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="action-bar">
        <button type="submit" disabled={busy}>
          Review mandate
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            edit();
            setFields(initial());
            setExposure(String(snapshot.mandate.maxExposureBps / 100));
            setSlippage(String(snapshot.mandate.maxSlippageBps / 100));
            setDrawdown(String(snapshot.mandate.maxDrawdownBps / 100));
          }}
        >
          Use current limits
        </button>
      </div>
    </form>
  );
}
