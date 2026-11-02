import { keccak256, type Address, type Hex } from 'viem';
import {
  proposalCalldata,
  mandateBaseline,
  type SignedMandate,
  type OwnerProposal,
} from './proposal.js';
import { nlToParamDiff } from '../llm.js';
import type { Policy, Mandate } from '../policy.js';
import type { Evidence, RuleTrace } from '../types.js';

export type DeskIntent =
  | { kind: 'exit' }
  | { kind: 'buy'; notionalB: string }
  | { kind: 'positions' }
  | { kind: 'spread' }
  | { kind: 'unknown' }
  | { kind: 'why'; verdict?: string; seq?: number }
  | { kind: 'change'; text: string };
export const supportedCommands =
  'Try: show positions, why did you WAIT last, buy 1 USDT of WHSK, sell now, set cap to 25, pause, revoke. BUY translates to an exact USDT amount for review; no request alone sends a trade.';
/** Whole-input matching prevents accidentally interpreting extra instructions as an owner action. */
export function parseIntent(input: string): DeskIntent {
  const t = input
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ');
  if (
    /^(sell now|exit my position|close my position|sell all whsk|exit position)$/.test(
      t,
    )
  )
    return { kind: 'exit' };
  const buy = /^buy (\d+(?:\.\d+)?) usdt(?: of)? whsk$/.exec(t);
  if (buy && Number.isFinite(Number(buy[1])) && Number(buy[1]) > 0)
    return { kind: 'buy', notionalB: buy[1] };
  if (
    /^(show (positions|p&l)|how am i doing|mera (p&l|pnl|positions) dikhao|positions dikhao|munafa dikhao)$/.test(
      t,
    )
  )
    return { kind: 'positions' };
  if (
    /^(what'?s the spread( now)?|show spread|spread( abhi)?( dikhao)?|abhi spread kya hai)$/.test(
      t,
    )
  )
    return { kind: 'spread' };
  const why =
    /^(?:why(?: did you)?|kyu|kyun)\s+(wait|reject|resize|trade)(?:\s+(?:kiya))?(?:\s+(last|#\d+))?$/.exec(
      t,
    );
  if (
    why?.[2]?.startsWith('#') &&
    !Number.isSafeInteger(Number(why[2].slice(1)))
  )
    return { kind: 'unknown' };
  if (why)
    return {
      kind: 'why',
      verdict: why[1].toUpperCase(),
      ...(why[2]?.startsWith('#') ? { seq: Number(why[2].slice(1)) } : {}),
    };
  if (
    /^(set cap to \d+(?:\.\d+)?(?: usdt)?|slippage \d+ bps|pause|revoke|band karo|cap \d+(?:\.\d+)?(?: usdt)? karo|slippage \d+ bps karo|rok do|mandate revoke karo)$/.test(
      t,
    )
  )
    return { kind: 'change', text: t };
  return { kind: 'unknown' };
}
export type DeskContext = {
  paused?: boolean;
  proposalError?: string;
  evidenceLabel?: string;
  target?: { vault: Address; chainId: number };
  decimalsB?: number;
  agent?: Address;
  policy?: Policy;
  mandate?: Mandate;
  evidence?: Evidence;
  receipts?: {
    seq: bigint;
    decision: { kind: string };
    ruleTrace: RuleTrace;
    llm: { explanation: string };
  }[];
  portfolio?: {
    balanceA: number;
    balanceB: number;
    excessVsHoldUSD: number;
    label: string;
    assumptions?: string;
  };
  latestAction?: {
    at: number;
    kind: string;
    trail: string;
    txHash?: string;
  };
  recentActions?: { at: number; kind: string; trail: string; txHash?: string }[];
};
export type DeskReply = {
  intent: DeskIntent;
  message: string;
  diff?: Record<string, unknown>;
  calldataHash?: string;
  ruleTrace?: RuleTrace;
  proposal?: OwnerProposal;
};
/** Pure read-only desk: no transport, wallet, account or execution callback is accepted. */
export function desk(input: string, context: DeskContext = {}): DeskReply {
  const intent = parseIntent(input);
  if (intent.kind === 'exit')
    return {
      intent,
      message:
        'Review your current WHSK position and a fresh sell quote below. No order has been sent.',
    };
  if (intent.kind === 'buy')
    return {
      intent,
      message: `Review a fresh quote to buy WHSK with ${intent.notionalB} USDT below. No order has been sent.`,
    };
  const answer = (message: string): DeskReply => ({ intent, message });
  if (intent.kind === 'unknown')
    return answer(`I couldn't recognise that command. ${supportedCommands}`);
  if (intent.kind === 'positions') {
    const p = context.portfolio;
    return answer(
      p
        ? `${p.label}. WHSK: ${p.balanceA.toFixed(6)}; USDT: ${p.balanceB.toFixed(6)}; P&L vs hold after gas: $${p.excessVsHoldUSD.toFixed(4)}. ${p.assumptions ?? 'Inventory reconstructed from verified receipts; assumes no deposits or withdrawals. No proven edge.'}`
        : 'Positions and P&L unavailable: load a contiguous, verified receipt history first.',
    );
  }
  if (intent.kind === 'why') {
    const observed = intent.seq === undefined
      ? [...(context.recentActions ?? [])].sort((a, b) => b.at - a.at)
          .find((a) => !intent.verdict || intent.verdict === a.kind)
      : undefined;
    if (observed)
      return answer(`Latest observed ${observed.kind} at ${new Date(observed.at * 1000).toISOString()}: ${observed.trail}${observed.txHash ? ` Transaction: ${observed.txHash}` : ''}. This feed observation is not an independently replayed receipt.`);
    const r = [...(context.receipts ?? [])]
      .sort((a, b) => (a.seq < b.seq ? 1 : -1))
      .find(
        (r) =>
          (intent.seq === undefined || r.seq === BigInt(intent.seq)) &&
          (!intent.verdict || r.decision.kind === intent.verdict),
      );
    return r
      ? {
          intent,
          message: `Receipt #${r.seq} · ${r.decision.kind}: ${r.llm.explanation}`,
          ruleTrace: r.ruleTrace,
        }
      : answer(
          'Matching receipt unavailable. Try a recorded decision and its exact sequence number.',
        );
  }
  if (intent.kind === 'spread') {
    const e = context.evidence;
    if (!e?.dexMid || e.cex.length !== 2)
      return answer(
        'Spread unavailable: both CEX mids and the DEX mid are required.',
      );
    const mids = e.cex
      .map((c) => `${c.venue}: ${((c.bid + c.ask) / 2).toFixed(8)}`)
      .join(', ');
    const mid = e.cex.reduce((s, c) => s + (c.bid + c.ask) / 2, 0) / 2;
    const costs = e.quotes.map((q) => {
      const buy = q.direction === 'BUY_A';
      const fair =
        (Number(q.amountIn) / 10 ** (buy ? e.decimalsB : e.decimalsA)) *
        (buy ? 1 / e.dexMid! : e.dexMid!);
      return `${q.direction} $${q.sizeB}: ${((1 - Number(q.quotedOut) / 10 ** (buy ? e.decimalsA : e.decimalsB) / fair) * 100).toFixed(4)}%`;
    });
    return answer(
      `${context.evidenceLabel ?? 'Captured snapshot; not a live quote'}. Snapshot ${e.now} (UTC seconds). DEX: ${e.dexMid.toFixed(8)}; ${mids}; basis: ${((e.dexMid / mid - 1) * 100).toFixed(4)}%. Measured cost at size: ${costs.join('; ') || 'unavailable'}.`,
    );
  }
  if (context.proposalError)
    return answer(`Owner proposal unavailable: ${context.proposalError}`);
  if (!context.policy || !context.mandate)
    return answer(
      'Owner proposal unavailable: a policy and signed mandate must be loaded first.',
    );
  const proposal = nlToParamDiff(
    intent.text,
    context.policy,
    context.mandate,
    context.decimalsB ?? context.evidence?.decimalsB ?? 6,
  );
  if (proposal.refused) return answer(proposal.refused);
  // The hash commits to the exact ABI payload. Never return a sendable transaction.
  const m = context.mandate;
  const action =
    'paused' in proposal.diff
      ? 'pause'
      : 'revoked' in proposal.diff
        ? 'revoke'
        : 'setMandate';
  const revoked = m.revoked || /^0x0{40}$/i.test(context.agent ?? '');
  if (action === 'revoke' && revoked)
    return answer(
      'The mandate is already revoked. No revoke proposal was created.',
    );
  if (action === 'pause' && context.paused)
    return answer(
      'The vault is already paused. No pause proposal was created.',
    );
  if (action === 'setMandate' && revoked)
    return answer(
      'The mandate is revoked. Set a nonzero agent in a new manual Ledger mandate review first.',
    );
  if (action === 'setMandate' && context.paused)
    return answer(
      'The vault is paused. Review its state and create a new manual Ledger mandate review before changing limits.',
    );
  if (!context.agent || m.maxDrawdownBps === undefined)
    return answer(
      'Exact owner calldata unavailable: agent and Task 9 drawdown cap must be read from the signed mandate.',
    );
  const signed: SignedMandate = {
    agent: context.agent!,
    expiry: BigInt(m.expiry),
    maxTradeInA: m.maxTradeInA,
    maxTradeInB: m.maxTradeInB,
    maxDailyInB: m.maxDailyInB,
    maxExposureBps: m.maxExposureBps,
    maxSlippageBps: m.maxSlippageBps,
    maxDrawdownBps: m.maxDrawdownBps!,
    minIntervalSec: BigInt(m.minIntervalSec),
    policyHash: m.policyHash as Hex,
  };
  const calldata = proposalCalldata(action, proposal.diff, signed);
  const ownerProposal: OwnerProposal = {
    action,
    diff: proposal.diff,
    calldataHash: keccak256(calldata),
    baselineHash: mandateBaseline(signed, context.paused ?? false),
    ...(context.target ? { target: context.target } : {}),
  };
  return {
    intent,
    message:
      'Proposal only. Review the diff in the Owner panel; the owner must sign with Ledger.',
    diff: proposal.diff,
    calldataHash: ownerProposal.calldataHash,
    proposal: ownerProposal,
  };
}

export const receiptSequenceOrder = (
  a: { seq: bigint | string },
  b: { seq: bigint | string },
) =>
  BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0;
