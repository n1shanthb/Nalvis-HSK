import { useState } from 'react';
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  keccak256,
  parseUnits,
  zeroAddress,
  type Hex,
} from 'viem';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
import { nlToParamDiff } from '../../../../packages/core/src/llm.js';
import { policySchema } from '../../../../packages/core/src/policy.js';
import policyJSON from '../../../../policy/default.json';
import {
  type DashboardChain,
  type VaultSnapshot,
  type VaultMandate,
  explorerLink,
} from '../lib/clients.js';
import {
  assertOwnerChain,
  BLIND_SIGNING_WARNING,
  connectLedger,
  sendOwnerAction,
  type OwnerSigner,
} from './ledger.js';
const policy = policySchema.parse(policyJSON);
export type MandateFields = Record<keyof VaultMandate, string>;
export const clampSlippage = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? Math.trunc(value) : 0));
export function fieldsFor(s: VaultSnapshot): MandateFields {
  return {
    ...Object.fromEntries(
      Object.entries(s.mandate).map(([k, v]) => [k, String(v)]),
    ),
    maxTradeInA: formatUnits(s.mandate.maxTradeInA, s.decimalsA),
    maxTradeInB: formatUnits(s.mandate.maxTradeInB, s.decimalsB),
    maxDailyInB: formatUnits(s.mandate.maxDailyInB, s.decimalsB),
  } as MandateFields;
}
function exactUnits(value: string, decimals: number) {
  if (
    !/^\d+(\.\d+)?$/.test(value) ||
    (value.split('.')[1]?.length ?? 0) > decimals
  )
    throw Error(`Amount must have at most ${decimals} decimal places`);
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount >= 2n ** 256n)
    throw Error('Amount is outside uint256 bounds');
  return amount;
}
export function validateMandate(
  fields: MandateFields,
  snapshot: VaultSnapshot,
  now = Math.floor(Date.now() / 1000),
): VaultMandate {
  const agent = getAddress(fields.agent);
  if (agent === getAddress(snapshot.owner) || agent === zeroAddress)
    throw Error('Agent must differ from owner and must not be zero');
  const uint = (s: string) => {
    if (!/^\d+$/.test(s) || BigInt(s) >= 2n ** 256n)
      throw Error('Expected a nonnegative uint256');
    return BigInt(s);
  };
  const expiry = uint(fields.expiry);
  if (expiry <= BigInt(now)) throw Error('Expiry must be in the future');
  const exposure = uint(fields.maxExposureBps);
  if (exposure > 10000n) throw Error('Exposure must be at most 10000 bps');
  if (!/^0x[0-9a-fA-F]{64}$/.test(fields.policyHash))
    throw Error('Policy hash must be 32 bytes');
  return {
    agent,
    expiry,
    maxTradeInA: exactUnits(fields.maxTradeInA, snapshot.decimalsA),
    maxTradeInB: exactUnits(fields.maxTradeInB, snapshot.decimalsB),
    maxDailyInB: exactUnits(fields.maxDailyInB, snapshot.decimalsB),
    maxExposureBps: Number(exposure),
    maxSlippageBps: clampSlippage(Number(fields.maxSlippageBps)),
    maxDrawdownBps: Number(uint(fields.maxDrawdownBps ?? '0')),
    minIntervalSec: uint(fields.minIntervalSec),
    policyHash: fields.policyHash as Hex,
  };
}
const labels: Record<keyof VaultMandate, string> = {
  agent: 'Agent address',
  expiry: 'Expiry (UTC unix seconds)',
  maxTradeInA: 'WHSK per trade',
  maxTradeInB: 'USDT per trade',
  maxDailyInB: 'USDT per UTC day',
  maxExposureBps: 'Exposure cap (bps)',
  maxSlippageBps: 'Slippage cap (bps)',
  maxDrawdownBps: 'Drawdown cap (bps)',
  minIntervalSec: 'Minimum interval (seconds)',
  policyHash: 'Policy hash',
};
const json = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? String(x) : x), 2);
export function MandateForm({
  chain,
  vault,
  snapshot,
  enabled = true,
  signerFactory = connectLedger,
}: {
  chain: DashboardChain;
  vault: `0x${string}`;
  snapshot: VaultSnapshot;
  enabled?: boolean;
  signerFactory?: (chain: number, index: number) => Promise<OwnerSigner>;
}) {
  const [fields, setFields] = useState(() => fieldsFor(snapshot)),
    [review, setReview] = useState<{
      data: Hex;
      diff: string;
      context: string;
    }>(),
    [message, setMessage] = useState(''),
    [text, setText] = useState(''),
    [nl, setNL] = useState(''),
    [account, setAccount] = useState(0),
    [busy, setBusy] = useState(false);
  const context = json({
    chain,
    vault,
    snapshot: { ...snapshot, blockNumber: 0n },
  });
  if (!enabled) return null;
  if (chain !== 133)
    return (
      <aside role="alert">
        Owner panel refuses chain {chain}. Ledger actions require chain 133
        only.
      </aside>
    );
  function preview(revoke = false) {
    setMessage('');
    setReview(undefined);
    try {
      assertOwnerChain(chain);
      const params = revoke ? undefined : validateMandate(fields, snapshot);
      const data = params
        ? encodeFunctionData({
            abi: vaultAbi,
            functionName: 'setMandate',
            args: [params],
          })
        : encodeFunctionData({ abi: vaultAbi, functionName: 'revoke' });
      setReview({
        data,
        context,
        diff: json({
          current: snapshot.mandate,
          proposed: params ?? { agent: zeroAddress, action: 'revoke' },
        }),
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Invalid mandate');
    }
  }
  async function send() {
    if (!review || review.context !== context || busy) return;
    setBusy(true);
    setMessage('');
    try {
      assertOwnerChain(chain);
      const signer = await signerFactory(chain, account);
      const hash = await sendOwnerAction({
        chainId: chain,
        vault,
        owner: snapshot.owner,
        data: review.data,
        signer,
      });
      setMessage(`Submitted ${hash}. Await inclusion on the testnet explorer.`);
      setReview(undefined);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ledger action failed');
    } finally {
      setBusy(false);
    }
  }
  function naturalLanguage() {
    try {
      const m = snapshot.mandate;
      const result = nlToParamDiff(
        text,
        policy,
        {
          ...m,
          expiry: Number(m.expiry),
          minIntervalSec: Number(m.minIntervalSec),
          revoked: m.agent === zeroAddress,
        },
        snapshot.decimalsB,
      );
      setNL(result.refused ?? json(result.diff));
    } catch (e) {
      setNL(e instanceof Error ? e.message : 'No parameter change');
    }
  }
  return (
    <aside className="owner">
      <p className="eyebrow">OWNER / LEDGER</p>
      <h3>Review a mandate change</h3>
      <p role="note">{BLIND_SIGNING_WARNING}</p>
      <p>
        Confirm the Ethereum app supports displaying the data hash. If the
        device cannot show it, reject the transaction. Chain 133 only; no
        private or agent keys are used.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          preview();
        }}
      >
        <div className="form-grid">
          {(Object.keys(labels) as (keyof VaultMandate)[]).map((key) => (
            <label key={key}>
              {labels[key]}
              <input
                required
                value={fields[key]}
                type={key === 'maxSlippageBps' ? 'number' : 'text'}
                min={key === 'maxSlippageBps' ? 0 : undefined}
                max={key === 'maxSlippageBps' ? 100 : undefined}
                onChange={(e) => {
                  setReview(undefined);
                  setFields({
                    ...fields,
                    [key]:
                      key === 'maxSlippageBps'
                        ? String(clampSlippage(Number(e.target.value)))
                        : e.target.value,
                  });
                }}
              />
            </label>
          ))}
        </div>
        <button disabled={busy}>Build setMandate review</button>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() => preview(true)}
        >
          Build revoke review
        </button>
      </form>
      <label>
        Ledger account index
        <input
          type="number"
          min="0"
          max="99"
          value={account}
          disabled={busy}
          onChange={(e) => {
            setAccount(Number(e.target.value));
            setReview(undefined);
          }}
        />
      </label>
      {review && (
        <div>
          <h4>Diff vs current mandate</h4>
          <pre>{review.diff}</pre>
          <p>To: {vault} · Chain 133 · Value 0 HSK</p>
          <p>
            Calldata hash <code>{keccak256(review.data)}</code>
          </p>
          <details>
            <summary>Exact calldata</summary>
            <code>{review.data}</code>
          </details>
          <button
            disabled={busy || review.context !== context}
            onClick={() => void send()}
          >
            {busy ? 'Check your Ledger…' : 'Sign and send reviewed action'}
          </button>
          {review.context !== context && (
            <p>Mandate changed; build a fresh review.</p>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <h4>Natural-language change</h4>
      <label>
        Request
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="be more conservative"
        />
      </label>
      <button className="secondary" onClick={naturalLanguage}>
        Show parameter diff
      </button>
      <pre aria-live="polite">{nl}</pre>
      <p>Suggestions do not change the mandate or send transactions.</p>
      <a
        href={explorerLink(133, 'address', vault)}
        target="_blank"
        rel="noreferrer"
      >
        Inspect vault ↗
      </a>
    </aside>
  );
}
export default MandateForm;
