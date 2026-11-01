import { encodeFunctionData, keccak256, type Address, type Hex } from 'viem';
import { vaultAbi } from '../abi/index.js';
import { hash } from '../canonical.js';
export type SignedMandate = {
  agent: Address;
  expiry: bigint;
  maxTradeInA: bigint;
  maxTradeInB: bigint;
  maxDailyInB: bigint;
  maxExposureBps: number;
  maxSlippageBps: number;
  maxDrawdownBps: number;
  minIntervalSec: bigint;
  policyHash: Hex;
};
export type OwnerProposal = {
  action: 'pause' | 'revoke' | 'setMandate';
  diff: Record<string, unknown>;
  calldataHash: Hex;
  baselineHash: Hex;
  target?: { vault: Address; chainId: number };
};
export const encodeMandate = (m: SignedMandate) =>
  encodeFunctionData({ abi: vaultAbi, functionName: 'setMandate', args: [m] });
export const mandateBaseline = (m: SignedMandate, paused: boolean) =>
  hash({ calldataHash: keccak256(encodeMandate(m)), paused });
export function proposalCalldata(
  action: OwnerProposal['action'],
  diff: Record<string, unknown>,
  m: SignedMandate,
): Hex {
  if (action === 'pause') {
    if (Object.keys(diff).length !== 1 || diff.paused !== true)
      throw Error('Invalid pause proposal');
    return encodeFunctionData({ abi: vaultAbi, functionName: 'pause' });
  }
  if (action === 'revoke') {
    if (Object.keys(diff).length !== 1 || diff.revoked !== true)
      throw Error('Invalid revoke proposal');
    return encodeFunctionData({ abi: vaultAbi, functionName: 'revoke' });
  }
  if (
    Object.keys(diff).length !== 1 ||
    !Object.keys(diff).every((k) =>
      ['maxTradeInB', 'maxSlippageBps'].includes(k),
    )
  )
    throw Error('Unsupported mandate diff');
  const cap = BigInt(String(diff.maxTradeInB ?? m.maxTradeInB));
  const slip = Number(diff.maxSlippageBps ?? m.maxSlippageBps);
  if (
    cap <= 0n ||
    cap > m.maxTradeInB ||
    !Number.isInteger(slip) ||
    slip < 1 ||
    slip > m.maxSlippageBps ||
    slip > 100
  )
    throw Error('Proposal must tighten current positive limits');
  return encodeMandate({ ...m, maxTradeInB: cap, maxSlippageBps: slip });
}
export function assertProposal(
  p: OwnerProposal,
  m: SignedMandate,
  paused: boolean,
  data: Hex,
) {
  if (mandateBaseline(m, paused) !== p.baselineHash)
    throw Error(
      'Vault mandate or pause state changed; request a fresh desk proposal',
    );
  if (
    keccak256(data) !== p.calldataHash ||
    keccak256(proposalCalldata(p.action, p.diff, m)) !== p.calldataHash
  )
    throw Error('Desk proposal calldata hash mismatch');
}
