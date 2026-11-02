import { addresses } from '../../../../packages/core/src/addresses.js';
import { useAgentFeed } from '../agent/useAgentFeed.js';
import { useReceiptEvents } from '../agent/useReceiptEvents.js';
import type { DashboardChain } from '../lib/clients.js';
import { EvidenceView } from './Evidence.js';
import { Portfolio } from './Portfolio.js';
/** Keep the receipt overlays and risk values when evidence moves out of Agent. */
export default function MarketEvidence({
  chain = 133,
}: {
  chain?: DashboardChain;
}) {
  const { feed } = useAgentFeed(chain);
  const receipts = useReceiptEvents(chain, !feed || feed.state.mode === 'live');
  const actions =
    feed?.actions ??
    receipts.data?.map((r) => ({
      at: r.at,
      intent: { type: 'Receipt', notionalB: 0 },
      final: { kind: ['TRADE', 'RESIZE', 'WAIT', 'REJECT'][r.args.kind ?? 3] },
      trail: 'On-chain receipt',
      rounds: [],
      violations: [],
      txHash: r.transactionHash,
      receiptHash: r.args.receiptHash,
    })) ??
    [];
  const trade = receipts.data?.find(
    (r) => r.args.kind === 0 || r.args.kind === 1,
  );
  const usdt = addresses[chain === 133 ? 133 : 177].usdt;
  const lastTradeB = trade
    ? Number(
        trade.args.tokenIn?.toLowerCase() === usdt.address.toLowerCase()
          ? trade.args.amountIn
          : trade.args.refOut,
      ) /
      10 ** usdt.decimals
    : undefined;
  return (
    <>
      <EvidenceView chain={chain} actions={actions} lastTradeB={lastTradeB} />
      <Portfolio chain={chain} />
    </>
  );
}
