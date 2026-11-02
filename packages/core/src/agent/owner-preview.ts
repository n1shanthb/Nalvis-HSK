import { formatUnits, type Hex } from 'viem';
import { hash } from '../canonical.js';
import type { SellOrder, SellSession } from '../copilot.js';
import {
  amountFor,
  check,
  quoteTwap,
  type MandateState,
  type ExecQuote,
  type Prepared,
} from './mandate-check.js';
import type { Action } from './schema.js';

/** Largest currently allowed SELL clip, in existing USDT-notional sizing units. */
export function sellActionFor(state: MandateState): Action {
  if (state.balanceA === 0n)
    throw Error('There is no WHSK position to sell. No swap can be submitted.');
  const maxA =
    state.balanceA < state.mandate.maxTradeInA
      ? state.balanceA
      : state.mandate.maxTradeInA;
  const daily =
    state.mandate.maxDailyInB > state.spentB
      ? state.mandate.maxDailyInB - state.spentB
      : 0n;
  let high = quoteTwap(state, maxA, false);
  if (high > daily) high = daily;
  let low = 0n;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const amount = amountFor(
      {
        type: 'SELL',
        notionalB: formatUnits(middle, state.decimalsB),
        urgency: 'now',
        reason: 'Owner-confirmed Copilot sell',
      },
      state,
    );
    if (amount <= maxA) low = middle;
    else high = middle - 1n;
  }
  if (low === 0n)
    throw Error('No sell size fits the current per-trade and daily limits.');
  return {
    type: 'SELL',
    notionalB: formatUnits(low, state.decimalsB),
    urgency: 'now',
    reason: 'Owner-confirmed Copilot sell',
  };
}
export function sellPreview(
  state: MandateState,
  quote: ExecQuote,
  session: SellSession,
) {
  const action = sellActionFor(state);
  const validUntil = Math.min(state.blockTime + 90, session.expiresAt);
  const checked = check(action, state, quote, {
    deadline: validUntil,
    validUntil,
  });
  const p = checked.prepared;
  const order: SellOrder = {
    version: 1,
    delegationHash: hash(session),
    chainId: state.chainId,
    vault: state.vault,
    policyHash: state.mandate.policyHash,
    tokenIn: p.tokenIn,
    notionalB: action.notionalB!,
    amountIn: String(p.amountIn),
    minOut: String(p.minOut),
    expectedOut: String(quote.amountOut),
    nonce: String(p.nonce),
    seq: String(state.seq),
    prevHead: state.head,
    stateHash: hash(state),
    createdAt: state.blockTime,
    validUntil,
  };
  return { action, checked, order, state, quote };
}
/** Exact owner-selected USDT size; deterministic checks may reject but never resize it. */
export function buyPreview(
  state: MandateState,
  quote: ExecQuote,
  session: SellSession,
  notionalB: string,
) {
  if (session.scope !== 'TRADE_WITHIN_MANDATE')
    throw Error('BUY requires an owner-authorized trade session');
  const action: Action = {
    type: 'BUY',
    notionalB,
    urgency: 'now',
    reason: 'Owner-confirmed Copilot buy',
  };
  const validUntil = Math.min(state.blockTime + 90, session.expiresAt);
  const checked = check(action, state, quote, { deadline: validUntil, validUntil });
  const p = checked.prepared;
  const order: SellOrder = {
    version: 1,
    delegationHash: hash(session),
    chainId: state.chainId,
    vault: state.vault,
    policyHash: state.mandate.policyHash,
    tokenIn: p.tokenIn,
    direction: 'BUY',
    notionalB,
    amountIn: String(p.amountIn),
    minOut: String(p.minOut),
    expectedOut: String(quote.amountOut),
    nonce: String(p.nonce),
    seq: String(state.seq),
    prevHead: state.head,
    stateHash: hash(state),
    createdAt: state.blockTime,
    validUntil,
  };
  return { action, checked, order, state, quote };
}
export function preparedSellOrder(order: SellOrder) {
  return {
    kind: 'TRADE' as const,
    direction: order.direction ?? 'SELL',
    tokenIn: order.tokenIn,
    amountIn: BigInt(order.amountIn),
    minOut: BigInt(order.minOut),
    validUntil: order.validUntil,
    deadline: order.validUntil,
    nonce: BigInt(order.nonce),
    prevHead: order.prevHead as Hex,
  };
}
export function matchesConfirmedSell(
  order: SellOrder,
  prepared: Prepared,
  seq: bigint,
) {
  return (
    seq === BigInt(order.seq) &&
    prepared.kind === 'TRADE' &&
    prepared.direction === (order.direction ?? 'SELL') &&
    prepared.tokenIn.toLowerCase() === order.tokenIn.toLowerCase() &&
    prepared.amountIn === BigInt(order.amountIn) &&
    prepared.minOut === BigInt(order.minOut) &&
    prepared.nonce === BigInt(order.nonce) &&
    prepared.prevHead === order.prevHead &&
    prepared.deadline === order.validUntil &&
    prepared.validUntil === order.validUntil
  );
}
