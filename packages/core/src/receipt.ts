import type { Address, Hex } from 'viem';
import { assertWritableChain } from './addresses.js';
import { hash, evidenceHash } from './canonical.js';
import { policyHash, type Policy } from './policy.js';
import type { Evidence, Decision, RuleTrace } from './types.js';
export type ReceiptInput = {
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
    nonce: bigint;
  };
};
export type ReceiptBody = Omit<ReceiptInput, 'policy'> & {
  version: 1;
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
  const { policy, evidence, decision, tx, ...rest } = input;
  assertWritableChain(evidence.executionChainId);
  const receipt: ReceiptBody = {
    version: 1,
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
    },
  });
}
