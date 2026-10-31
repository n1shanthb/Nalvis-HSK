import { encodeFunctionData, keccak256, type Address } from 'viem';
import { vaultAbi } from '../abi/index.js';
import { nlToParamDiff } from '../llm.js';
import type { Policy, Mandate } from '../policy.js';
import type { Evidence, RuleTrace } from '../types.js';

export type DeskIntent =
  | { kind: 'positions' }
  | { kind: 'spread' }
  | { kind: 'unknown' }
  | { kind: 'why'; verdict?: string; seq?: number }
  | { kind: 'change'; text: string };
export const supportedCommands =
  "Try: show positions, show P&L, why did you WAIT last, why REJECT #2, what's the spread now, set cap to 25, slippage 50 bps, pause, revoke.";
/** Whole-input matching prevents accidentally interpreting extra instructions as an owner action. */
export function parseIntent(input: string): DeskIntent {
  const t = input
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ');
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
  if (why)
    return {
      kind: 'why',
      verdict: why[1].toUpperCase(),
      ...(why[2]?.startsWith('#') ? { seq: Number(why[2].slice(1)) } : {}),
    };
  if (
    /^(set cap to \d+(?:\.\d+)?|slippage \d+ bps|pause|revoke|cap \d+(?:\.\d+)? karo|slippage \d+ bps karo|rok do|mandate revoke karo)$/.test(
      t,
    )
  )
    return { kind: 'change', text: t };
  return { kind: 'unknown' };
}
export type DeskContext = {
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
};
export type DeskReply = {
  intent: DeskIntent;
  message: string;
  diff?: Record<string, unknown>;
  calldataHash?: string;
  ruleTrace?: RuleTrace;
};
/** Pure read-only desk: no transport, wallet, account or execution callback is accepted. */
export function desk(input: string, context: DeskContext = {}): DeskReply {
  const intent = parseIntent(input);
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
      `Snapshot ${e.now} (UTC seconds). DEX: ${e.dexMid.toFixed(8)}; ${mids}; basis: ${((e.dexMid / mid - 1) * 100).toFixed(4)}%. Measured cost at size: ${costs.join('; ') || 'unavailable'}.`,
    );
  }
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
  if (
    action === 'setMandate' &&
    (!context.agent || m.maxDrawdownBps === undefined)
  )
    return answer(
      'Exact owner calldata unavailable: agent and Task 9 drawdown cap must be read from the signed mandate.',
    );
  const calldata = encodeFunctionData({
    abi: vaultAbi,
    functionName: action,
    args:
      action === 'setMandate'
        ? [
            {
              agent: context.agent!,
              expiry: BigInt(m.expiry),
              maxTradeInA: m.maxTradeInA,
              maxTradeInB: BigInt(
                String(proposal.diff.maxTradeInB ?? m.maxTradeInB),
              ),
              maxDailyInB: m.maxDailyInB,
              maxExposureBps: m.maxExposureBps,
              maxSlippageBps: Number(
                proposal.diff.maxSlippageBps ?? m.maxSlippageBps,
              ),
              maxDrawdownBps: m.maxDrawdownBps!,
              minIntervalSec: BigInt(m.minIntervalSec),
              policyHash: m.policyHash,
            },
          ]
        : [],
  } as never);
  return {
    intent,
    message:
      'Proposal only. Review the diff in the Owner panel; the owner must sign with Ledger.',
    diff: proposal.diff,
    calldataHash: keccak256(calldata),
  };
}
