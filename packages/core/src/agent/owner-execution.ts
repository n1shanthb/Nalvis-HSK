import { type Address, type Hex } from 'viem';
import { hash } from '../canonical.js';
import {
  assertSellAuthorization,
  sellOrderId,
  type SignedSellOrder,
} from '../copilot.js';
import { preparedSellOrder } from './owner-preview.js';
import {
  ownerReceiptSchema,
  ownerReceiptHash,
  type OwnerReceipt,
} from './owner-receipt.js';
import { check } from './mandate-check.js';
import {
  validateAgentPolicy,
  strategyHash,
  type AgentConfig,
} from './policy.js';
import type { AgentClients } from './agent.js';
import type { Store } from './store.js';
import type { Journal } from './journal.js';

/** Called under the same agent/service writer lock. Never changes a confirmed amount or floor. */
export async function executeOwnerSell(args: {
  signed: SignedSellOrder;
  clients: AgentClients;
  store: Store;
  journal: Journal;
  config: AgentConfig;
  settled(receipt: OwnerReceipt): Promise<void>;
}) {
  const { clients, store, journal, config } = args;
  if (!clients.readOwner) throw Error('Owner authorization reader unavailable');
  if (await store.read('pending.json'))
    throw Error('Unresolved pending transaction; never resend');
  const localPolicy = validateAgentPolicy(config),
    s = await clients.readState();
  const owner = await clients.readOwner(s.block);
  const signed = await assertSellAuthorization(args.signed, {
    owner,
    vault: s.vault,
    chainId: s.chainId,
    policyHash: s.mandate.policyHash,
    now: s.blockTime,
  });
  if (
    s.mandate.policyHash !== localPolicy ||
    signed.order.seq !== String(s.seq)
  )
    throw Error('Mandate or receipt sequence changed; refresh review');
  const id = sellOrderId(signed);
  if (await store.read(`owner-orders/${id}.json`))
    throw Error('Owner confirmation already consumed');
  const direction = signed.order.direction ?? 'SELL';
  const action = {
    type: direction,
    notionalB: signed.order.notionalB,
    urgency: 'now' as const,
    reason: `Owner-confirmed Copilot ${direction.toLowerCase()}; not an autonomous model decision`,
  };
  const quote = await clients.quote(action, s),
    prepared = preparedSellOrder(signed.order);
  const checked = check(action, s, quote, prepared);
  if (!checked.ok)
    throw Error('Confirmed order no longer fits the live mandate or quote');
  const simulation = await clients.simulate(s, prepared);
  if (!simulation.ok) throw Error('Confirmed order simulation failed');
  const evidence = await clients.collectEvidence(),
    evidenceHash = await journal.artifact('evidence', evidence);
  const stateHash = await journal.artifact('states', s);
  await journal.append(
    'MANDATE_CHECK',
    {
      source: 'owner-command',
      requestId: id,
      stateBlock: String(s.block),
      stateHash,
      action,
      quote,
      prepared,
      ok: true,
      violations: [],
      headroom: checked.headroom,
    },
    s.blockTime,
  );
  const body = {
    version: 4 as const,
    marketDataChainId: 177 as const,
    executionChainId: s.chainId,
    contract: s.vault,
    seq: s.seq,
    prevHead: s.head,
    policyHash: localPolicy,
    evidenceHash,
    strategy: {
      mode: 'owner-command' as const,
      provider: 'owner-session' as const,
      models: { strategist: 'none' as const, fitter: 'none' as const },
      promptVersions: [],
      strategyHash: strategyHash(config),
    },
    intent: action,
    fit: {
      rounds: 0,
      trail: action.reason,
      legs: [],
      acceptedDirectionChange: false,
    },
    final: prepared,
    mandateCheck: { stateBlock: s.block, stateHash, ok: true },
    journalHead: journal.head,
    journalFrom: journal.head,
    simulation,
    authorization: signed,
    owner,
    state: s,
    quote,
  };
  const receipt = ownerReceiptSchema.parse({
    ...body,
    receiptHash: ownerReceiptHash(body),
  });
  const current = await clients.readState(),
    currentOwner = await clients.readOwner(current.block);
  await assertSellAuthorization(signed, {
    owner: currentOwner,
    vault: current.vault,
    chainId: current.chainId,
    policyHash: current.mandate.policyHash,
    now: current.blockTime,
  });
  const recheck = check(
    action,
    current,
    await clients.quote(action, current),
    prepared,
  );
  if (
    !recheck.ok ||
    current.seq !== s.seq ||
    hash(current.mandate) !== hash(s.mandate)
  )
    throw Error('State changed before execution; refresh review');
  if (
    !(await clients.simulate(current, prepared, receipt.receiptHash as Hex)).ok
  )
    throw Error('Final receipt-bound simulation failed');
  await store.write(`receipts/${receipt.receiptHash}.json`, receipt);
  // Persist replay protection and durable intent before the only send attempt.
  await store.write(`owner-orders/${id}.json`, {
    receiptHash: receipt.receiptHash,
    status: 'submitted-or-unknown',
  });
  await store.write('copilot-pending.json', {
    id,
    receiptHash: receipt.receiptHash,
  });
  await store.write('pending.json', {
    receiptHash: receipt.receiptHash,
    seq: s.seq,
    prevHead: s.head,
  });
  let settlement: { transactionHash: Hex };
  try {
    settlement = await clients.send(receipt);
  } catch {
    // Only the production transport's explicit fsync-before-broadcast guarantee
    // can establish that rejection happened before any submission attempt.
    if (
      clients.durableBroadcastMarker &&
      !(await store.read('.pending.json'))
    ) {
      await store.write('pending.json', null);
      await store.write('copilot-pending.json', null);
      await store.write(`owner-orders/${id}.json`, {
        receiptHash: receipt.receiptHash,
        status: 'rejected-before-broadcast',
      });
    }
    throw Error(
      'Owner order was rejected before submission or its settlement is uncertain; inspect the durable intent',
    );
  }
  const mined = { ...receipt, settlement };
  await store.write(`receipts/${receipt.receiptHash}.json`, mined);
  await journal.append(
    'ACTION',
    {
      kind: prepared.kind,
      amountIn: String(prepared.amountIn),
      minOut: String(prepared.minOut),
      receiptHash: receipt.receiptHash,
      txHash: settlement.transactionHash,
      mode: 'owner-command',
      reason: action.reason,
    },
    current.blockTime,
  );
  await args.settled(mined);
  await store.write('pending.json', null);
  await store.write('.pending.json', null);
  await store.write(`owner-orders/${id}.json`, {
    receiptHash: receipt.receiptHash,
    status: 'mined',
    transactionHash: settlement.transactionHash,
  });
  return mined;
}
export type OwnerReader = (block?: bigint) => Promise<Address>;
