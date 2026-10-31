import type { Address, Hex } from 'viem';
import { assertWritableChain } from './addresses.js';
import { hash, evidenceHash } from './canonical.js';
import { policyHash, type Policy } from './policy.js';
import type { Evidence, Decision, RuleTrace } from './types.js';
export type ReceiptInput = {
  version?: 1 | 2;
  contract: Address;
  seq: bigint;
  prevHead: Hex;
  policy: Policy;
  evidence: Evidence;
  decision: Decision;
  llm: {
    model?: string;
    promptHash?: Hex;
    outputHash?: Hex;
    explanation: string;
  };
  tx: {
    to: Address;
    data: Hex;
    minOut: bigint;
    deadline: number;
    validUntil?: number;
    nonce: bigint;
  };
};
export type ReceiptBody = Omit<ReceiptInput, 'policy' | 'version'> & {
  version: 1 | 2;
  chainId: number;
  marketDataChainId: number;
  executionChainId: number;
  policyHash: Hex;
  evidenceHash: Hex;
  ruleTrace: RuleTrace;
};
export function buildReceipt(
  input: ReceiptInput,
): ReceiptBody & { receiptHash: Hex } {
  const { version = 2, policy, evidence, decision, tx, ...rest } = input;
  if (
    version === 2 &&
    (evidence.decisionTime === undefined ||
      !evidence.riskInput ||
      evidence.validUntil === undefined ||
      tx.validUntil !== evidence.validUntil ||
      decision.validUntil !== evidence.validUntil ||
      ((decision.kind === 'TRADE' || decision.kind === 'RESIZE') &&
        !decision.riskCheck))
  )
    throw new Error('v2 requires policy expiry and risk evidence');
  assertWritableChain(evidence.executionChainId);
  const receipt: ReceiptBody = {
    version,
    chainId: evidence.executionChainId,
    marketDataChainId: evidence.marketDataChainId,
    executionChainId: evidence.executionChainId,
    ...rest,
    policyHash: policyHash(policy),
    evidenceHash: evidenceHash(evidence),
    evidence,
    decision,
    ruleTrace: decision.ruleTrace,
    tx,
  };
  return { ...receipt, receiptHash: receiptHash(receipt) };
}
/** Only calldata is excluded: it embeds receiptHash and would otherwise make a circular commitment. */
export function receiptHash(receipt: ReceiptBody) {
  const {
    version,
    chainId,
    marketDataChainId,
    executionChainId,
    contract,
    seq,
    prevHead,
    policyHash,
    evidenceHash,
    evidence,
    decision,
    ruleTrace,
    llm,
    tx,
  } = receipt;
  const body = {
    version,
    chainId,
    marketDataChainId,
    executionChainId,
    contract,
    seq,
    prevHead,
    policyHash,
    evidenceHash,
    evidence,
    decision,
    ruleTrace,
    llm,
  };
  return hash({
    ...body,
    tx: {
      to: tx.to,
      minOut: tx.minOut,
      deadline: tx.deadline,
      nonce: tx.nonce,
      ...(tx.validUntil !== undefined ? { validUntil: tx.validUntil } : {}),
    },
  });
}
