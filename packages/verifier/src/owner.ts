import { z } from 'zod';
import {
  decodeEventLog,
  decodeFunctionData,
  parseAbiItem,
  type Address,
  type Hex,
} from 'viem';
import {
  ownerReceiptSchema,
  ownerReceiptHash,
} from '../../core/src/agent/owner-receipt.js';
import { assertSellAuthorization } from '../../core/src/copilot.js';
import { canonical, hash } from '../../core/src/canonical.js';
import { check } from '../../core/src/agent/mandate-check.js';
import {
  validateChain,
  type JournalEntry,
} from '../../core/src/agent/journal.js';
import { vaultAbi, receiptEvent } from '../../core/src/abi/index.js';
import type { Store } from '../../core/src/agent/store.js';
import { chainHead, type ChainReader, type Verification } from './verify.js';

export async function verifyOwnerReceipt(
  input: unknown,
  reader: ChainReader,
  store: Store | undefined,
  txHash?: Hex,
): Promise<Verification> {
  const result: Verification = {
    status: 'FAIL',
    checks: [],
    label:
      'Owner-confirmed execution within a signed mandate. Not an autonomous AI strategy decision.',
  };
  let current = 'v4_schema';
  const require = (name: string, pass: boolean) => {
    current = name;
    result.checks.push({ name, pass });
    if (!pass) throw Error(name);
  };
  try {
    const r = ownerReceiptSchema.parse(input);
    result.receiptV4 = r;
    require('v4_receipt_hash', ownerReceiptHash(r) === r.receiptHash);
    require('v4_network', (await reader.chainId()) === r.executionChainId &&
      r.state.chainId === r.executionChainId);
    require('v4_state_hash', hash(r.state) === r.mandateCheck.stateHash &&
      r.state.block === r.mandateCheck.stateBlock &&
      r.state.vault.toLowerCase() === r.contract.toLowerCase() &&
      r.state.mandate.policyHash === r.policyHash);
    current = 'v4_owner_signatures';
    await assertSellAuthorization(r.authorization, {
      owner: r.owner as Address,
      vault: r.contract,
      chainId: r.executionChainId,
      policyHash: r.policyHash,
      now: r.state.blockTime,
    });
    require('v4_owner_signatures', true);
    const o = r.authorization.order;
    const direction = o.direction ?? 'SELL';
    require('v4_confirmed_order', r.intent.type === direction &&
      r.intent.notionalB === o.notionalB &&
      r.final.direction === direction &&
      r.final.kind === 'TRADE' &&
      r.final.tokenIn.toLowerCase() === o.tokenIn.toLowerCase() &&
      r.final.amountIn === BigInt(o.amountIn) &&
      r.final.minOut === BigInt(o.minOut) &&
      r.final.nonce === BigInt(o.nonce) &&
      r.final.prevHead === o.prevHead &&
      r.seq === BigInt(o.seq) &&
      r.prevHead === o.prevHead &&
      r.final.deadline === o.validUntil &&
      r.final.validUntil === o.validUntil);
    require('v4_mandate_replay', check(r.intent, r.state, r.quote, r.final)
      .ok &&
      r.mandateCheck.ok &&
      r.simulation.ok &&
      r.simulation.block === r.state.block);
    require('v4_historical_readers', !!reader.agentState &&
      !!reader.owner &&
      !!reader.timestamp);
    const historical = await reader.agentState!(
      r.contract,
      r.state.block,
      r.state.agent,
    );
    require('v4_historical_state', canonical(historical) ===
      canonical(r.state));
    require('v4_historical_owner', (
      await reader.owner!(r.contract, r.state.block)
    ).toLowerCase() === r.owner.toLowerCase());
    require('v4_artifact_store', !!store);
    const evidence = await store!.read(`evidence/${r.evidenceHash}.json`);
    require('v4_evidence_hash', evidence != null &&
      hash(evidence) === r.evidenceHash);
    const entries = (await store!.text('journal.jsonl'))!
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JournalEntry);
    validateChain(entries);
    require('v4_journal_anchor', entries.some(
      (e) =>
        e.entryHash === r.journalHead &&
        e.type === 'MANDATE_CHECK' &&
        e.data.source === 'owner-command',
    ));
    const transactionHash = txHash ?? r.settlement?.transactionHash;
    require('v4_transaction_hash', !!transactionHash);
    const mined = z
      .object({
        status: z.literal('success'),
        blockNumber: z.bigint(),
        to: z.string(),
        logs: z.array(
          z
            .object({
              address: z.string(),
              data: z.string(),
              topics: z.array(z.string()),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .parse(await reader.receipt(transactionHash!));
    const tx = z
      .object({ from: z.string(), to: z.string(), input: z.string() })
      .passthrough()
      .parse(await reader.transaction(transactionHash!));
    require('v4_destination_and_sender', mined.to.toLowerCase() ===
      r.contract.toLowerCase() &&
      tx.to.toLowerCase() === r.contract.toLowerCase() &&
      tx.from.toLowerCase() === r.state.agent.toLowerCase());
    const decoded = decodeFunctionData({
      abi: vaultAbi,
      data: tx.input as Hex,
    });
    require('v4_calldata', decoded.functionName === 'trade' &&
      canonical(decoded.args?.[0]) ===
        canonical({
          tokenIn: r.final.tokenIn,
          amountIn: r.final.amountIn,
          minOut: r.final.minOut,
          deadline: BigInt(r.final.deadline),
          validUntil: BigInt(r.final.validUntil),
          nonce: r.final.nonce,
          prevHead: r.prevHead,
          receiptHash: r.receiptHash,
          kind: 0,
        }));
    const events = mined.logs
      .filter((l) => l.address.toLowerCase() === r.contract.toLowerCase())
      .flatMap((l) => {
        try {
          return [
            decodeEventLog({
              abi: [parseAbiItem(receiptEvent)],
              data: l.data as Hex,
              topics: l.topics as [Hex, ...Hex[]],
            }).args,
          ];
        } catch {
          return [];
        }
      });
    const e = events[0];
    require('v4_receipt_event', events.length === 1 &&
      e.seq === r.seq &&
      e.receiptHash === r.receiptHash &&
      e.prevHead === r.prevHead &&
      e.policyHash === r.policyHash &&
      e.kind === 0 &&
      e.tokenIn.toLowerCase() === r.final.tokenIn.toLowerCase() &&
      e.amountIn === r.final.amountIn &&
      e.minOut === r.final.minOut &&
      e.amountOut >= r.final.minOut);
    const at = await reader.timestamp!(mined.blockNumber);
    require('v4_execution_expiry', at <= r.final.deadline &&
      at <= r.authorization.delegation.expiresAt);
    require('v4_chain_head', (await reader.head(
      r.contract,
      mined.blockNumber,
    )) === chainHead(r.prevHead, r.receiptHash, r.seq));
    result.status = 'PASS';
  } catch {
    if (!result.checks.some((c) => c.name === current && !c.pass))
      result.checks.push({
        name: current,
        pass: false,
        detail: 'Owner receipt validation or independent replay failed.',
      });
  }
  return result;
}
