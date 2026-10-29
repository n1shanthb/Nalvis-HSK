import { useState } from 'react';
import { type Hex } from 'viem';
import {
  verify,
  rpcReader,
  type Verification,
} from '../../../../packages/verifier/src/verify.js';
import { recordedReader } from '../../../../packages/verifier/src/recorded.js';
import recording from '../../../../packages/verifier/test/fixtures/chain.json';
import trade from '../../../../packages/verifier/test/fixtures/receipts/0-0x764e5f6b06e1d95edc1df44663489a0238727a6fc9465f153c788d96bbc6e045.json';
import { localReceipts } from '../lib/receipts.js';
import { clientFor, type DashboardChain } from '../lib/clients.js';
export const recordedTrade = trade;
export function VerifyView({
  chain,
  runRecorded = (input: unknown) => verify(input, recordedReader(recording)),
}: {
  chain: DashboardChain;
  runRecorded?: (input: unknown) => Promise<Verification>;
}) {
  const [hash, setHash] = useState(''),
    [json, setJSON] = useState(''),
    [result, setResult] = useState<Verification>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState('');
  async function run(recorded: boolean) {
    setBusy(true);
    setError('');
    setResult(undefined);
    setMode(
      recorded
        ? 'Recorded local anvil — prices not real. Offline RPC replay; not live chain verification.'
        : `Live chain ${chain}`,
    );
    try {
      if (recorded) setResult(await runRecorded(trade));
      else {
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
          throw Error('Enter a 32-byte transaction hash');
        const input: unknown = json.trim()
          ? JSON.parse(json)
          : (await localReceipts()).find(
              (r) =>
                r.executionChainId === chain &&
                r.settlement?.transactionHash.toLowerCase() ===
                  hash.toLowerCase(),
            );
        if (!input)
          throw Error(
            'Matching receipt JSON unavailable. Paste the keeper receipt below.',
          );
        const url = clientFor(chain).chain.rpcUrls.default.http[0];
        setResult(await verify(input, rpcReader(url), { txHash: hash as Hex }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <p className="eyebrow">04 / INDEPENDENT REPLAY</p>
      <h2>Verify a receipt</h2>
      <p>
        Re-hash evidence, replay the deterministic engine, then match calldata,
        Receipt events and chain links.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(false);
        }}
      >
        <label>
          Transaction hash
          <input
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            placeholder="0x…"
            required
          />
        </label>
        <label>
          Keeper receipt JSON (optional if served locally)
          <textarea value={json} onChange={(e) => setJSON(e.target.value)} />
        </label>
        <button disabled={busy} type="submit">
          {busy ? 'Verifying…' : 'Verify on selected chain'}
        </button>
      </form>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void run(true)}
      >
        Replay recorded Anvil trade
      </button>
      <p>{mode}</p>
      {error && <p role="alert" className="verify-alert">FAIL — {error}</p>}
      {result && (
        <div aria-live="polite" className="verify-result-card">
          <div className="verify-header-bar">
            <span className={`status-banner-badge ${result.status}`}>{result.status}</span>
            <span className="verify-title-label">{result.label}</span>
          </div>
          <h3>{result.status}</h3>
          <p className="verify-desc">{result.label}</p>
          <ul className="verify-checks-list">
            {result.checks.map((c, i) => (
              <li key={i} className={`verify-check-row ${c.pass ? 'pass' : 'fail'}`}>
                <b className="check-tag">{c.pass ? 'PASS' : 'FAIL'}</b> · <span className="check-name">{c.name}</span>
                {c.detail ? ` — ${c.detail}` : ''}
              </li>
            ))}
          </ul>
          {result.metrics && (
            <div className="verify-metrics-box">
              <span className="verify-metrics-title">VERIFIED EXECUTION METRICS</span>
              <dl>
                {Object.entries(result.metrics).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
