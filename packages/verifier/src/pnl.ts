import { parseEvidenceJSON } from '../../core/src/index.js';
import { canonicalCheck } from './canonical-check.js';
import { chainHead, type Verification } from './verify.js';
/** Pair inventory marked at the last available evidence CEX mid; gas charged separately in USD. */
export function pnl(results: Verification[]) {
  if (
    !results.length ||
    results.some((r) => r.status !== 'PASS' || !r.receipt || !r.metrics)
  )
    throw Error('pnl_verified_receipts: every receipt must pass');
  const rows = [...results].sort((a, b) =>
    a.receipt!.seq < b.receipt!.seq ? -1 : 1,
  );
  const first = rows[0].receipt!;
  const evidence = parseEvidenceJSON(canonicalCheck(first.evidence));
  const raw = evidence.sources.replay.raw as {
    state: { balanceA: string; balanceB: string };
  };
  const initialA = BigInt(raw.state.balanceA),
    initialB = BigInt(raw.state.balanceB);
  let balanceA = Number(initialA) / 10 ** evidence.decimalsA,
    balanceB = Number(initialB) / 10 ** evidence.decimalsB;
  const holdA = balanceA,
    holdB = balanceB;
  let gasUSD = 0,
    mark: number | null = null,
    markSeq: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].receipt!,
      m = rows[i].metrics!;
    if (
      r.contract.toLowerCase() !== first.contract.toLowerCase() ||
      r.executionChainId !== first.executionChainId
    )
      throw Error('pnl_chain: mixed contracts or chains');
    if (i) {
      const previous = rows[i - 1].receipt!;
      if (
        r.seq !== previous.seq + 1n ||
        r.prevHead !==
          chainHead(previous.prevHead, previous.receiptHash, previous.seq)
      )
        throw Error('pnl_chain: receipts must be contiguous');
    }
    if (m.cexMid !== null) {
      mark = m.cexMid;
      markSeq = String(r.seq);
    }
    if (m.gasUSD === null) {
      if (mark === null) throw Error('pnl_valuation: no available CEX mid');
      gasUSD += m.gasHSK * mark;
    } else gasUSD += m.gasUSD;
    const input =
      Number(BigInt(m.amountIn)) / 10 ** (m.buy ? m.decimalsB : m.decimalsA);
    const output =
      Number(BigInt(m.amountOut)) / 10 ** (m.buy ? m.decimalsA : m.decimalsB);
    if (m.buy) {
      balanceB -= input;
      balanceA += output;
    } else {
      balanceA -= input;
      balanceB += output;
    }
  }
  if (mark === null) throw Error('pnl_valuation: missing CEX mid');
  const portfolioUSD = balanceA * mark + balanceB,
    holdUSD = holdA * mark + holdB;
  return {
    label: rows[0].label,
    count: rows.length,
    mark,
    markSeq,
    balanceA,
    balanceB,
    portfolioUSD,
    holdUSD,
    gasUSD,
    excessVsHoldUSD: portfolioUSD - gasUSD - holdUSD,
    assumptions:
      'No deposits/withdrawals between receipts; tokenB assumed USD-pegged; native gas valued using evidence HSK CEX mid. Last available CEX mark is used when a hold lacks quotes. Pool fees already included in fills; no proven edge.',
  };
}
