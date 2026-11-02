import { useCallback } from 'react';
import { executionReceiptSchema } from '../../../../packages/core/src/agent/owner-receipt.js';
import { parseEvidenceJSON } from '../../../../packages/core/src/serialization.js';
import {
  agentFeedBase,
  readFeedJSON,
  snapshotFor,
} from '../agent/feed-client.js';
import {
  displayTime,
  loadDeployment,
  type DashboardChain,
} from '../lib/clients.js';
import { useResource } from '../lib/useResource.js';

export async function readDecisionArtifacts(
  receiptHash: string,
  chain: DashboardChain,
  provenance: string,
) {
  if (!/^0x[\da-f]{64}$/i.test(receiptHash))
    throw Error('Invalid receipt hash');
  const live = provenance === 'live';
  const base = live ? agentFeedBase() : '';
  if (live && !base) throw Error('Live artifact feed is not configured');
  const path = (kind: string, hash: string) =>
    live
      ? `/feed/${kind}/${hash}`
      : `${snapshotFor(chain)}/${kind}/${hash}.json`;
  const receipt = executionReceiptSchema.parse(
    await readFeedJSON(base ?? '', path('receipts', receiptHash)),
  );
  const deployment = await loadDeployment(chain);
  if (
    receipt.executionChainId !== chain ||
    receipt.receiptHash.toLowerCase() !== receiptHash.toLowerCase() ||
    receipt.contract.toLowerCase() !== deployment.vault.toLowerCase()
  )
    throw Error('Receipt deployment or chain mismatch');
  const evidence = parseEvidenceJSON(
    JSON.stringify(
      await readFeedJSON(base ?? '', path('evidence', receipt.evidenceHash)),
    ),
  );
  if (evidence.executionChainId !== chain)
    throw Error('Evidence chain mismatch');
  return { receipt, evidence };
}

export function DecisionArtifacts({
  receiptHash,
  chain,
  provenance,
}: {
  receiptHash: string;
  chain: DashboardChain;
  provenance: string;
}) {
  const resource = useResource(
    useCallback(
      () => readDecisionArtifacts(receiptHash, chain, provenance),
      [receiptHash, chain, provenance],
    ),
  );
  const data = resource.data;
  return (
    <section aria-label="Keeper artifact provenance">
      {resource.loading && <p>Loading keeper evidence provenance…</p>}
      {resource.error && (
        <p>
          Evidence artifact unavailable.{' '}
          {data && 'Showing last observation; refresh failed.'} Use Verify with
          the exact keeper receipt JSON.
        </p>
      )}
      {data && (
        <>
          <p>
            Recorded evidence: {displayTime(data.evidence.now)} · market block{' '}
            {String(data.evidence.blockNumber)} (chain{' '}
            {data.evidence.marketDataChainId}) · execution block{' '}
            {String(data.evidence.executionBlockNumber)} (chain {chain}).
          </p>
          <p>
            Recorded mandate validation:{' '}
            {data.receipt.mandateCheck.ok ? 'passed' : 'failed'} · state block{' '}
            {String(data.receipt.mandateCheck.stateBlock)}.
          </p>
          <p>
            Recorded simulation:{' '}
            {data.receipt.simulation.ok ? 'passed' : 'failed'}
            {data.receipt.simulation.error
              ? ` · ${data.receipt.simulation.error}`
              : ''}
            . These artifact fields are not independent verification.
          </p>
          <details>
            <summary>Evidence sources and commitments</summary>
            <p>
              Evidence hash: <code>{data.receipt.evidenceHash}</code>
            </p>
            <p>
              Policy hash: <code>{data.receipt.policyHash}</code>
            </p>
            <pre>
              {JSON.stringify(
                data.evidence.sources,
                (_, value) =>
                  typeof value === 'bigint' ? String(value) : value,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
