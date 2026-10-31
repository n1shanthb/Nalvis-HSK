import { humanError } from '../lib/errors.js';
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
import { vaultAbi, erc20Abi } from '../../../../packages/core/src/abi/index.js';
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
  tokens: readonly Address[] = [
    addresses[133].whsk.address,
    addresses[133].usdt.address,
  ],
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
  if (!tokens.some((a) => a.toLowerCase() === withdrawal.token.toLowerCase()))
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
  onConfirmed,
}: {
  chain: number;
  vault: Address;
  snapshot: VaultSnapshot;
  onConfirmed?: () => void | Promise<void>;
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
    [hash, setHash] = useState<Hex>(),
    [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const revoked = snapshot.mandate.agent.toLowerCase() === zeroAddress;
  const tokens =
    snapshot.tokenA && snapshot.tokenB
      ? [snapshot.tokenA, snapshot.tokenB]
      : undefined;
  const balance = token === 'whsk' ? snapshot.balanceA : snapshot.balanceB;
  const context = `${chain}:${vault}:${snapshot.owner}:${snapshot.paused}:${snapshot.mandate.agent}:${tokens?.join(',')}`;
  if (chain !== 133)
    return (
      <p role="alert">Owner actions refuse chain {chain}. Chain 133 only.</p>
    );
  function preview(action: OwnerAction) {
    setReview(undefined);
    setMessage('');
    setHash(undefined);
    setRevokeConfirmed(false);
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
      if (action === 'withdraw' && (!tokens || balance === undefined))
        throw Error(
          'Vault token balances are not loaded. Refresh before withdrawing.',
        );
      if (
        action === 'withdraw' &&
        parseUnits(
          amount,
          token === 'whsk' ? snapshot.decimalsA : snapshot.decimalsB,
        ) > balance!
      )
        throw Error('Withdrawal exceeds the vault balance.');
      const data = ownerActionCalldata(
        chain,
        action,
        action === 'withdraw'
          ? {
              token: tokens![token === 'whsk' ? 0 : 1],
              amount: parseUnits(
                amount,
                token === 'whsk' ? snapshot.decimalsA : snapshot.decimalsB,
              ),
              to: getAddress(to),
            }
          : undefined,
        tokens,
      );
      setReview({ data, action, context });
    } catch (e) {
      setMessage(humanError(e));
    }
  }
  async function sign() {
    if (
      !review ||
      busy ||
      review.context !== context ||
      (review.action === 'revoke' && !revokeConfirmed)
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      assertOwnerChain(chain);
      if (review.action === 'withdraw') {
        const available = await clientFor(133).readContract({
          address: tokens![token === 'whsk' ? 0 : 1],
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [vault],
        });
        if (
          parseUnits(
            amount,
            token === 'whsk' ? snapshot.decimalsA : snapshot.decimalsB,
          ) > available
        )
          throw Error('Withdrawal exceeds the vault balance.');
      }
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
      if (receipt.status === 'success') await onConfirmed?.();
      setMessage(
        receipt.status === 'success'
          ? 'Owner action confirmed'
          : 'Transaction reverted; refresh vault state and review again.',
      );
    } catch (e) {
      setMessage(humanError(e));
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
      {revoked && <p>Agent revoked</p>}
      {snapshot.tokenMismatch && (
        <p role="alert">
          Vault token mismatch: withdrawal uses the actual tokenA/tokenB
          addresses.
        </p>
      )}
      <div className="action-bar">
        {(['pause', 'unpause', 'revoke'] as const).map((a) => (
          <button
            key={a}
            disabled={
              busy ||
              (a === 'pause' && snapshot.paused) ||
              (a === 'unpause' && !snapshot.paused) ||
              (a === 'revoke' && revoked)
            }
            onClick={() => preview(a)}
          >
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
            <option value="usdt">
              {snapshot.tokenMismatch ? `Token B (${snapshot.tokenB})` : 'USDT'}
            </option>
            <option value="whsk">
              {snapshot.tokenMismatch ? `Token A (${snapshot.tokenA})` : 'WHSK'}
            </option>
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
              {amount}{' '}
              {snapshot.tokenMismatch
                ? tokens?.[token === 'whsk' ? 0 : 1]
                : token.toUpperCase()}{' '}
              to {to}
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
          {review.action === 'revoke' && (
            <label>
              <input
                type="checkbox"
                checked={revokeConfirmed}
                onChange={(e) => setRevokeConfirmed(e.target.checked)}
              />
              Revoke removes agent authority immediately
            </label>
          )}
          <button
            disabled={
              busy ||
              review.context !== context ||
              (review.action === 'revoke' && !revokeConfirmed)
            }
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
