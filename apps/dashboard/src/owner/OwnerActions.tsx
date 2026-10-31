import { useState } from 'react';
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { addresses } from '../../../../packages/core/src/addresses.js';
import { vaultAbi } from '../../../../packages/core/src/abi/index.js';
import { clientFor, explorerLink, type VaultSnapshot } from '../lib/clients.js';
import {
  assertOwnerChain,
  BLIND_SIGNING_WARNING,
  connectLedger,
  sendOwnerAction,
} from './ledger.js';
export type OwnerAction = 'pause' | 'unpause' | 'revoke' | 'withdraw';
export function ownerActionCalldata(
  chain: number,
  action: OwnerAction,
  withdrawal?: { token: Address; amount: bigint; to: Address },
): Hex {
  assertOwnerChain(chain);
  if (action !== 'withdraw')
    return encodeFunctionData({ abi: vaultAbi, functionName: action });
  if (
    !withdrawal ||
    withdrawal.amount <= 0n ||
    getAddress(withdrawal.to) === zeroAddress
  )
    throw Error('Enter a positive amount and a valid recipient.');
  if (
    ![addresses[133].whsk.address, addresses[133].usdt.address].some(
      (a) => a.toLowerCase() === withdrawal.token.toLowerCase(),
    )
  )
    throw Error('Choose a verified vault token.');
  return encodeFunctionData({
    abi: vaultAbi,
    functionName: 'withdraw',
    args: [withdrawal.token, withdrawal.amount, withdrawal.to],
  });
}
export function OwnerActions({
  chain,
  vault,
  snapshot,
}: {
  chain: number;
  vault: Address;
  snapshot: VaultSnapshot;
}) {
  const [token, setToken] = useState<'whsk' | 'usdt'>('usdt'),
    [amount, setAmount] = useState(''),
    [to, setTo] = useState(snapshot.owner);
  const [review, setReview] = useState<{
      data: Hex;
      action: OwnerAction;
      context: string;
    }>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState<Hex>();
  const context = `${chain}:${vault}:${snapshot.owner}`;
  if (chain !== 133)
    return (
      <p role="alert">Owner actions refuse chain {chain}. Chain 133 only.</p>
    );
  function preview(action: OwnerAction) {
    setReview(undefined);
    setMessage('');
    setHash(undefined);
    try {
      if (
        action === 'withdraw' &&
        (!/^\d+(\.\d+)?$/.test(amount) ||
          (amount.split('.')[1]?.length ?? 0) >
            (token === 'whsk' ? snapshot.decimalsA : snapshot.decimalsB))
      )
        throw Error(
          'Enter an exact token amount within its decimal precision.',
        );
      const data = ownerActionCalldata(
        chain,
        action,
        action === 'withdraw'
          ? {
              token: addresses[133][token].address,
              amount: parseUnits(
                amount,
                token === 'whsk' ? snapshot.decimalsA : snapshot.decimalsB,
              ),
              to: getAddress(to),
            }
          : undefined,
      );
      setReview({ data, action, context });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not build review');
    }
  }
  async function sign() {
    if (!review || busy || review.context !== context) return;
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
      setReview(undefined);
      setMessage('Submitted. Waiting for confirmation…');
      const receipt = await clientFor(133).waitForTransactionReceipt({
        hash: tx,
      });
      setMessage(
        receipt.status === 'success'
          ? 'Owner action confirmed'
          : 'Transaction reverted; refresh vault state and review again.',
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Ledger action failed. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  const invalidate = () => {
    setReview(undefined);
    setMessage('');
  };
  return (
    <article className="agent-card">
      <h3>Owner actions</h3>
      <div className="action-bar">
        {(['pause', 'unpause', 'revoke'] as const).map((a) => (
          <button key={a} disabled={busy} onClick={() => preview(a)}>
            {a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
      <fieldset disabled={busy}>
        <legend>Withdraw</legend>
        <label>
          Token
          <select
            value={token}
            onChange={(e) => {
              setToken(e.target.value as typeof token);
              invalidate();
            }}
          >
            <option value="usdt">USDT</option>
            <option value="whsk">WHSK</option>
          </select>
        </label>
        <label>
          Amount
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label>
          Recipient
          <input
            value={to}
            onChange={(e) => {
              setTo(e.target.value as Address);
              invalidate();
            }}
          />
        </label>
        <button onClick={() => preview('withdraw')}>Review withdrawal</button>
      </fieldset>
      {review && (
        <div>
          <h4>Review {review.action}</h4>
          <p>Chain 133 · To vault {vault} · Value 0 HSK</p>
          {review.action === 'withdraw' && (
            <p>
              {amount} {token.toUpperCase()} to {to}
            </p>
          )}
          <p>{BLIND_SIGNING_WARNING}</p>
          <p>
            Calldata hash <code>{keccak256(review.data)}</code>
          </p>
          <details>
            <summary>Exact action calldata</summary>
            <code>{review.data}</code>
          </details>
          <button
            disabled={busy || review.context !== context}
            onClick={() => void sign()}
          >
            Sign reviewed action on Ledger
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {hash && <a href={explorerLink(133, 'tx', hash)}>View transaction ↗</a>}
    </article>
  );
}
