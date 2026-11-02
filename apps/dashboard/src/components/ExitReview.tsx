import { useContext, useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { type Hex } from 'viem';
import { hash } from '../../../../packages/core/src/canonical.js';
import {
  sellOrderSchema,
  sellSessionMessage,
} from '../../../../packages/core/src/copilot.js';
import { LedgerContext } from '../owner/LedgerContext.js';
import { connectLedger } from '../owner/ledger.js';
import { displayTime } from '../lib/clients.js';
import { TransactionState } from './DecisionHistory.js';
import { useCopilotSession } from '../owner/CopilotSession.js';
const liveSchema = z.object({
  chainId: z.literal(177),
  owner: z.string(),
  vault: z.string(),
  policyHash: z.string(),
  now: z.number(),
  enabled: z.boolean(),
});
const previewSchema = z.object({
  executable: z.boolean(),
  reason: z.string().optional(),
  balanceA: z.string(),
  balanceB: z.string(),
  asOf: z.number(),
  block: z.string(),
  pnlReason: z.string(),
  order: sellOrderSchema.optional(),
  sellWHSK: z.string().optional(),
  expectedUSDT: z.string().optional(),
  minimumUSDT: z.string().optional(),
  remainingWHSK: z.string().optional(),
  partialExit: z.boolean().optional(),
  estimatedGasHSK: z.string().nullable().optional(),
  poolFeeWHSK: z.string().optional(),
  slippageBps: z.number().optional(),
});
async function request(body?: unknown) {
  const response = await fetch(
    '/api/copilot',
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(55000),
        }
      : { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw Error(
      'Could not validate the live position and review. Refresh before confirming.',
    );
  return response.json();
}
export function ExitReview({
  allowTrading = false,
}: {
  allowTrading?: boolean;
}) {
  const ledger = useContext(LedgerContext),
    address = ledger?.address;
  const { sessionKey, delegation, ownerSignature, setOwnerSignature, clear } =
    useCopilotSession();
  const [preview, setPreview] = useState<z.infer<typeof previewSchema>>();
  const [enabled, setEnabled] = useState(false),
    [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [rejected, setRejected] = useState(false),
    [orderId, setOrderId] = useState('');
  const [status, setStatus] = useState(''),
    [transactionHash, setTransactionHash] = useState('');
  const [now, setNow] = useState(Date.now() / 1000);
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    setPreview(undefined);
    try {
      const state = liveSchema.parse(await request());
      setEnabled(state.enabled);
      setIsOwner(address?.toLowerCase() === state.owner.toLowerCase());
      const old = delegation.current;
      if (
        !old ||
        old.owner.toLowerCase() !== state.owner.toLowerCase() ||
        old.policyHash !== state.policyHash ||
        old.expiresAt <= state.now
      ) {
        const account = privateKeyToAccount(generatePrivateKey());
        sessionKey.current = account;
        delegation.current = {
          version: 1,
          scope: 'SELL_WITHIN_MANDATE',
          chainId: 177,
          owner: state.owner as Hex,
          vault: state.vault as Hex,
          sessionKey: account.address,
          policyHash: state.policyHash as Hex,
          issuedAt: state.now,
          expiresAt: state.now + 900,
          nonce: generatePrivateKey(),
        };
        setOwnerSignature(undefined);
      }
      setPreview(
        previewSchema.parse(
          await request({ op: 'preview', session: delegation.current }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review unavailable');
    } finally {
      setBusy(false);
    }
  }, [address]);
  useEffect(() => {
    setOrderId('');
    setStatus('');
    setTransactionHash('');
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      !orderId ||
      ['mined', 'rejected', 'needs_review', 'unavailable'].includes(status)
    )
      return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch('/api/copilot?id=' + orderId, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw Error();
        const result = z
          .object({
            status: z.enum([
              'queued',
              'processing',
              'mined',
              'rejected',
              'needs_review',
              'unavailable',
            ]),
            transactionHash: z
              .string()
              .regex(/^0x[\da-f]{64}$/i)
              .optional(),
            reason: z.string().optional(),
          })
          .parse(await response.json());
        if (active) {
          setStatus(result.status);
          if (result.transactionHash)
            setTransactionHash(result.transactionHash);
          if (result.reason) setError(result.reason);
        }
      } catch {
        if (active)
          setError(
            'Order status unavailable. Do not resubmit blindly; inspect Activity and the pending intent.',
          );
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderId, status]);
  const expired = !preview?.order || now >= preview.order.validUntil;
  const canTrade = allowTrading && isOwner && enabled;
  async function authorize() {
    if (!canTrade || !delegation.current) return;
    const session = delegation.current;
    setBusy(true);
    setError('');
    let signer: Awaited<ReturnType<typeof connectLedger>> | undefined;
    try {
      signer = await connectLedger(177, ledger?.accountIndex ?? 0);
      if (
        (await signer.address()).toLowerCase() !==
          session.owner.toLowerCase() ||
        !signer.signMessage
      )
        throw Error('The configured vault owner must authorize this session.');
      const signature = await signer.signMessage(sellSessionMessage(session));
      if (
        delegation.current !== session ||
        session.expiresAt <= Date.now() / 1000
      )
        throw Error('Session changed or expired.');
      setOwnerSignature(signature);
    } catch {
      setError(
        'Session authorization failed or was cancelled. No order was submitted.',
      );
    } finally {
      await signer?.disconnect();
      setBusy(false);
    }
  }
  async function confirm() {
    if (
      !canTrade ||
      busy ||
      expired ||
      !preview?.executable ||
      !preview.order ||
      !delegation.current ||
      !sessionKey.current ||
      !ownerSignature
    )
      return;
    setBusy(true);
    setError('');
    try {
      const signed = {
        delegation: delegation.current,
        ownerSignature,
        order: preview.order,
        orderSignature: await sessionKey.current.signMessage({
          message: { raw: hash(preview.order) },
        }),
      };
      const result = z
        .object({
          id: z.string().regex(/^0x[\da-f]{64}$/i),
          status: z.literal('queued'),
        })
        .parse(await request({ op: 'confirm', signed }));
      setOrderId(result.id);
      setStatus(result.status);
    } catch {
      setError(
        'Confirmation was rejected or its response is uncertain. Inspect Activity before attempting a new order.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (rejected)
    return <p role="status">Sell review rejected. No order was submitted.</p>;
  return (
    <section
      className="exit-review agent-card"
      aria-label="Review owner-directed sell"
    >
      <p className="eyebrow">OWNER-DIRECTED EXIT · MAINNET 177 · REAL FUNDS</p>
      <h3>Review your WHSK → USDT sell</h3>
      {busy && <p role="status">Reading or reviewing…</p>}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <p>
            Read block {preview.block} · {displayTime(preview.asOf)}
          </p>
          <dl>
            <div>
              <dt>WHSK position</dt>
              <dd>{preview.balanceA}</dd>
            </div>
            <div>
              <dt>USDT cash</dt>
              <dd>{preview.balanceB}</dd>
            </div>
            <div>
              <dt>Profit / loss</dt>
              <dd>Unavailable · {preview.pnlReason}</dd>
            </div>
            {preview.order && (
              <>
                <div>
                  <dt>Sell WHSK</dt>
                  <dd>{preview.sellWHSK}</dd>
                </div>
                <div>
                  <dt>Estimated USDT received</dt>
                  <dd>{preview.expectedUSDT}</dd>
                </div>
                <div>
                  <dt>Minimum USDT received</dt>
                  <dd>{preview.minimumUSDT}</dd>
                </div>
                <div>
                  <dt>Pool fee (included in quote)</dt>
                  <dd>{preview.poolFeeWHSK} WHSK</dd>
                </div>
                <div>
                  <dt>Estimated keeper gas</dt>
                  <dd>{preview.estimatedGasHSK ?? 'Unavailable'} HSK</dd>
                </div>
                <div>
                  <dt>WHSK remaining</dt>
                  <dd>{preview.remainingWHSK}</dd>
                </div>
                <div>
                  <dt>Slippage ceiling</dt>
                  <dd>{preview.slippageBps} bps</dd>
                </div>
              </>
            )}
          </dl>
          <p>
            Proceeds stay in the vault. This is an owner-directed sell, not an
            autonomous AI trade.
          </p>
          {preview.partialExit && (
            <p>
              This is a capped sell clip, not a guaranteed full exit. Remaining
              WHSK is shown above; no later legs are authorized automatically.
            </p>
          )}
          {!preview.executable && <p role="status">{preview.reason}</p>}
          {preview.order && (
            <p>
              {expired
                ? 'Quote expired. Refresh before confirming.'
                : `Review expires ${displayTime(preview.order.validUntil)}.`}
            </p>
          )}
        </>
      )}
      {!canTrade && (
        <p>
          Only the connected vault owner can confirm a sell from their own
          workspace. Viewing Nishanth’s activity grants no trading authority.
          {allowTrading && !enabled
            ? ' Keeper order processing is not enabled yet.'
            : ''}
        </p>
      )}
      {!orderId && (
        <div className="action-bar">
          <button onClick={() => void load()} disabled={busy}>
            Refresh review
          </button>
          {!ownerSignature && (
            <button
              onClick={() => void authorize()}
              disabled={!canTrade || busy || !preview?.executable}
            >
              Authorize 15-minute sell session with Ledger
            </button>
          )}
          <button
            onClick={() => void confirm()}
            disabled={
              !canTrade ||
              busy ||
              expired ||
              !ownerSignature ||
              !preview?.executable
            }
          >
            Confirm sell
          </button>
          <button
            className="secondary"
            onClick={() => setRejected(true)}
            disabled={busy}
          >
            Reject
          </button>
        </div>
      )}
      {ownerSignature && !orderId && (
        <>
          <p>
            Owner session authorized until{' '}
            {delegation.current
              ? displayTime(delegation.current.expiresAt)
              : 'unavailable'}
            . Confirm uses the temporary browser key; no per-trade Ledger
            prompt. Closing the page ends the session.
          </p>
          <button
            className="secondary"
            onClick={() => {
              clear();
              void load();
            }}
            disabled={busy}
          >
            End trading session
          </button>
        </>
      )}
      {orderId && (
        <p role="status">
          Order: {status}. Queued or processing does not confirm a swap. The
          keeper independently rechecks the live mandate and quote.
        </p>
      )}
      {transactionHash && (
        <TransactionState hash={transactionHash} chain={177} />
      )}
    </section>
  );
}
