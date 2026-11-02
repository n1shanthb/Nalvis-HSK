import type { createAgent } from '../../core/src/agent/agent.js';
import type { Store } from '../../core/src/agent/store.js';
import type { OwnerReceipt } from '../../core/src/agent/owner-receipt.js';
import type { copilotQueue } from '../../core/src/copilot-queue.js';

/** Run only inside the existing serialized service cycle and persistent writer lock. */
export async function processCopilotOrder(
  queue: NonNullable<ReturnType<typeof copilotQueue>>,
  agent: Awaited<ReturnType<typeof createAgent>>,
  store: Store,
) {
  const previous = await store.read<{ id: string }>('copilot-current.json');
  if (previous) {
    const intent = await store.read<{ id: string; receiptHash: string }>(
      'copilot-pending.json',
    );
    const receipt = intent
      ? await store.read<OwnerReceipt>(`receipts/${intent.receiptHash}.json`)
      : undefined;
    if (await store.read('pending.json')) return 'needs_review';
    await queue.finish(
      previous.id,
      receipt?.settlement
        ? {
            status: 'mined',
            transactionHash: receipt.settlement.transactionHash,
          }
        : {
            status: 'needs_review',
            reason:
              'Interrupted processing. This order will never be replayed automatically.',
          },
    );
    await store.write('copilot-current.json', null);
    await store.write('copilot-pending.json', null);
  }
  if (await store.read('pending.json')) return 'needs_review';
  const claimed = await queue.claim();
  if (!claimed) return 'idle';
  await store.write('copilot-current.json', { id: claimed.id });
  try {
    const receipt = await agent.executeOwnerSell(claimed.signed);
    await queue.finish(claimed.id, {
      status: 'mined',
      transactionHash: receipt.settlement!.transactionHash,
    });
  } catch {
    if (await store.read('pending.json')) {
      await queue.finish(claimed.id, {
        status: 'needs_review',
        reason:
          'Transaction submission or settlement is uncertain. Inspect the stored intent; never resend automatically.',
      });
      return 'needs_review';
    }
    await queue.finish(claimed.id, {
      status: 'rejected',
      reason:
        'Owner/session, expiry, current mandate, quote or simulation changed. Nothing was sent; refresh the review.',
    });
  }
  await store.write('copilot-current.json', null);
  await store.write('copilot-pending.json', null);
  return 'processed';
}
