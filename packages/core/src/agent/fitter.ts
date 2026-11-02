import { formatUnits } from 'viem';
import type { Action, Leg } from './schema.js';
import { fitterSchema, fitterReplySchema } from './schema.js';
import {
  check,
  amountFor,
  quoteTwap,
  type MandateState,
  type CheckResult,
  type ExecQuote,
} from './mandate-check.js';
import {
  completeValidated,
  FITTER_PROMPT_V1,
  FITTER_REPLY_PROMPT_V1,
} from './strategist.js';
import type { Journal } from './journal.js';
import type { Provider } from './provider.js';
export type FitResult = {
  outcome: 'fits' | 'WAIT' | 'NEEDS_OWNER';
  rounds: number;
  action: Action;
  legs: Leg[];
  trail: string;
  retryAt?: number;
  acceptedDirectionChange: boolean;
};
export function needsOwner(s: MandateState) {
  return s.paused || s.revoked || BigInt(s.blockTime) >= s.mandate.expiry;
}
export function retryAt(s: MandateState, c: CheckResult): number {
  const daily = c.violations.some((v) => v.limit === 'DailyCap')
    ? s.turnover
        .filter((t) => t.expiresAt > s.blockTime)
        .sort((a, b) => a.expiresAt - b.expiresAt)[0]?.expiresAt
    : undefined;
  return Math.max(
    s.blockTime + 60,
    ...c.violations.map((v) => v.resetsAt ?? 0),
    daily ?? 0,
  );
}
export function projectLeg(
  s: MandateState,
  a: Action,
  q: ExecQuote,
  at: number,
): MandateState {
  const buy = a.type === 'BUY',
    amount = amountFor(a, s),
    spent = buy ? amount : quoteTwap(s, amount, false);
  const turnover = [
    ...s.turnover,
    { expiresAt: (Math.floor(s.blockTime / 1800) + 48) * 1800, amountB: spent },
  ].filter((t) => t.expiresAt > at);
  const balanceA = buy ? s.balanceA + q.amountOut : s.balanceA - amount,
    balanceB = buy ? s.balanceB - amount : s.balanceB + q.amountOut;
  const total = quoteTwap(s, balanceA, false) + balanceB;
  const preTotal = quoteTwap(s, s.balanceA, false) + s.balanceB;
  const high = s.highWaterMark > preTotal ? s.highWaterMark : preTotal;
  return {
    ...s,
    blockTime: at,
    balanceA,
    balanceB,
    lastTradeAt: BigInt(s.blockTime),
    nextNonce: s.nextNonce + 1n,
    spentB: turnover.reduce((n, t) => n + t.amountB, 0n),
    turnover,
    highWaterMark: total > high ? total : high,
  };
}
export async function fitToMandate(args: {
  provider: Provider;
  journal: Journal;
  action: Action;
  thesis: string;
  state: MandateState;
  initial: CheckResult;
  market?: unknown;
  marketContext?: 'fresh-dex-cex';
  quote: (a: Action, s: MandateState) => Promise<ExecQuote>;
  rounds?: number;
  charge?: (usd: number) => Promise<void>;
  canCall?: () => boolean;
}): Promise<FitResult> {
  const s = args.state;
  let action = args.action,
    violations = args.initial.violations;
  const finish = async (r: FitResult) => {
    await args.journal.append('FIT_RESULT', { ...r }, s.blockTime);
    return r;
  };
  const waiting = (rounds: number): FitResult => ({
    outcome: needsOwner(s) ? 'NEEDS_OWNER' : 'WAIT',
    rounds,
    action: {
      type: 'HOLD',
      urgency: 'next_window',
      reason: 'No compliant accepted variant',
    },
    legs: [],
    trail: `Agent wanted ${args.action.notionalB ?? '0'} USDT ${args.action.type} · ${violations.map((v) => v.limit).join(', ')} · WAIT`,
    retryAt: retryAt(s, { ...args.initial, violations }),
    acceptedDirectionChange: false,
  });
  if (needsOwner(s)) return finish(waiting(0));
  for (let round = 1; round <= (args.rounds ?? 3); round++) {
    const common = {
      marketContext: args.marketContext,
      executionChainId: s.chainId,
      provider: args.provider,
      journal: args.journal,
      round,
      now: s.blockTime,
      charge: args.charge,
      canCall: args.canCall,
    };
    const output = await completeValidated({
      ...common,
      role: 'fitter',
      system: FITTER_PROMPT_V1,
      promptVersion: 'FITTER_PROMPT_V1',
      schema: fitterSchema,
      input: {
        original: args.action,
        market: args.market ?? {},
        executionQuote: await args.quote(action, s),
        action,
        thesis: args.thesis,
        reason: action.reason,
        violations,
        headroom: args.initial.headroom,
        units: { tokenADecimals: s.decimalsA, tokenBDecimals: s.decimalsB },
        headroomHuman: {
          maxNowA: formatUnits(args.initial.headroom.maxNowA, s.decimalsA),
          maxNowB: formatUnits(args.initial.headroom.maxNowB, s.decimalsB),
          dailyRemainingB: formatUnits(
            args.initial.headroom.dailyRemainingB,
            s.decimalsB,
          ),
        },
        cooldownSec: String(s.mandate.minIntervalSec),
        rollingResetTimes: s.turnover,
        executionPrice: formatUnits(
          quoteTwap(s, 10n ** BigInt(s.decimalsA), false),
          s.decimalsB,
        ),
      },
    });
    if (!output?.proposal) continue;
    const proposal = output.proposal;
    let projected = { ...s };
    let invalid = false;
    if (proposal.directionChanged !== (proposal.type !== args.action.type)) {
      violations = [
        {
          limit: 'directionChanged',
          required: String(proposal.type !== args.action.type),
          allowed: String(proposal.directionChanged),
        },
      ];
      continue;
    }
    for (let i = 0; i < proposal.legs.length; i++) {
      const leg = proposal.legs[i];
      if (
        leg.notBefore < s.blockTime ||
        (i > 0 &&
          leg.notBefore <
            proposal.legs[i - 1].notBefore + Number(s.mandate.minIntervalSec))
      ) {
        violations = [
          {
            limit: 'notBefore',
            required: 'ordered cooldown windows',
            allowed: String(leg.notBefore),
          },
        ];
        invalid = true;
        break;
      }
      projected = {
        ...projected,
        blockTime: leg.notBefore,
        turnover: projected.turnover.filter((t) => t.expiresAt > leg.notBefore),
      };
      projected.spentB = projected.turnover.reduce((n, t) => n + t.amountB, 0n);
      const candidate: Action = {
        ...action,
        type: proposal.type,
        notionalB: leg.notionalB,
      };
      const q = await args.quote(candidate, projected),
        c = check(candidate, projected, q);
      const stateHash = await args.journal.artifact('states', projected);
      await args.journal.append(
        'MANDATE_CHECK',
        {
          stateBlock: String(projected.block),
          stateHash,
          action: candidate,
          quote: q,
          ok: c.ok,
          violations: c.violations,
          headroom: c.headroom,
          projected: true,
          round,
          leg: i,
        },
        s.blockTime,
      );
      if (!c.ok) {
        violations = c.violations;
        invalid = true;
        break;
      }
      if (i + 1 < proposal.legs.length)
        projected = projectLeg(
          projected,
          candidate,
          q,
          proposal.legs[i + 1].notBefore,
        );
    }
    if (invalid) continue;
    const reply = await completeValidated({
      ...common,
      role: 'strategist',
      system: FITTER_REPLY_PROMPT_V1,
      promptVersion: 'FITTER_REPLY_PROMPT_V1',
      schema: fitterReplySchema,
      input: {
        original: args.action,
        thesis: args.thesis,
        fitterProposal: proposal,
        explanation: output.explanation,
      },
    });
    if (reply?.decision === 'withdraw') return finish(waiting(round));
    if (reply?.decision === 'revise') {
      action = reply.revisedAction!;
      const q = await args.quote(action, s);
      const c = check(action, s, q);
      if (c.ok && action.type !== 'HOLD' && action.type === args.action.type)
        return finish({
          outcome: 'fits',
          rounds: round,
          action,
          legs: [{ notionalB: action.notionalB!, notBefore: s.blockTime }],
          trail: `Agent revised to ${action.notionalB} USDT ${action.type}`,
          acceptedDirectionChange: action.type !== args.action.type,
        });
      violations = c.violations;
      continue;
    }
    if (reply?.decision === 'accept') {
      const first = proposal.legs[0],
        now = first.notBefore <= s.blockTime;
      return finish({
        outcome: now ? 'fits' : 'WAIT',
        rounds: round,
        action: now
          ? { ...action, type: proposal.type, notionalB: first.notionalB }
          : {
              type: 'HOLD',
              urgency: 'next_window',
              reason: 'Accepted scheduled leg; reconfirm on retry',
            },
        legs: proposal.legs,
        trail: `Agent wanted ${args.action.notionalB} USDT ${args.action.type} · fitter: ${proposal.legs.map((l) => l.notionalB).join(' + ')} USDT ${proposal.type} across cooldown · ${now ? 'leg 1 ready' : 'scheduled retry'} · later legs require fresh reconfirmation`,
        ...(!now ? { retryAt: first.notBefore } : {}),
        acceptedDirectionChange: proposal.directionChanged,
      });
    }
  }
  return finish(waiting(args.rounds ?? 3));
}
