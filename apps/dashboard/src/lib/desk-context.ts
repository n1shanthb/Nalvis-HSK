import { readDeskMandate } from '../../../../packages/core/src/desk/live.js';
import { canonical } from '../../../../packages/core/src/canonical.js';
import { parseEvidenceJSON } from '../../../../packages/core/src/serialization.js';
import { policySchema } from '../../../../packages/core/src/policy.js';
import { verify, rpcReader } from '../../../../packages/verifier/src/verify.js';
import { pnl } from '../../../../packages/verifier/src/pnl.js';
import { localReceipts } from './receipts.js';
import { clientFor, loadDeployment, type DashboardChain } from './clients.js';
export async function liveDeskContext(chain: DashboardChain) {
  const receipts = (await localReceipts())
    .filter((r) => r.executionChainId === chain)
    .sort((a, b) => (a.seq < b.seq ? -1 : 1));
  if (!receipts.length) return {};
  const results = await Promise.all(
    receipts.map((r) =>
      verify(r, rpcReader(clientFor(chain).chain.rpcUrls.default.http[0])),
    ),
  );
  if (results.some((r) => r.status !== 'PASS'))
    throw Error(
      'Receipt verification failed; no unverified balances are displayed',
    );
  const evidence = parseEvidenceJSON(canonical(receipts.at(-1)!.evidence));
  const raw = evidence.sources.replay.raw as {
    policy: unknown;
    mandate: Record<string, unknown>;
  };
  const policy = policySchema.parse(raw.policy);
  const base = {
    receipts,
    results,
    portfolio: pnl(results),
    evidence,
    policy,
    evidenceLabel: 'Last verified receipt snapshot; not a live quote',
  };
  try {
    const d = await loadDeployment(chain);
    if (
      receipts.some((r) => r.contract.toLowerCase() !== d.vault.toLowerCase())
    )
      throw Error('Receipt vault differs from current deployment');
    const live = await readDeskMandate(
      clientFor(chain),
      d.vault,
      chain,
      policy,
    );
    return { ...base, ...live };
  } catch (e) {
    return {
      ...base,
      proposalError:
        e instanceof Error ? e.message : 'Live vault state unavailable',
    };
  }
}
