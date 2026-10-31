import { canonical } from '../../../../packages/core/src/canonical.js';
import { parseEvidenceJSON } from '../../../../packages/core/src/serialization.js';
import {
  policySchema,
  mandateSchema,
} from '../../../../packages/core/src/policy.js';
import type { DeskContext } from '../../../../packages/core/src/desk/index.js';
import { verify, rpcReader } from '../../../../packages/verifier/src/verify.js';
import { pnl } from '../../../../packages/verifier/src/pnl.js';
import { localReceipts } from './receipts.js';
import {
  clientFor,
  loadDeployment,
  readVault,
  type DashboardChain,
} from './clients.js';
export async function liveDeskContext(
  chain: DashboardChain,
): Promise<DeskContext> {
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
  let mandate = mandateSchema.parse({
    ...raw.mandate,
    ...Object.fromEntries(
      ['maxTradeInA', 'maxTradeInB', 'maxDailyInB'].map((k) => [
        k,
        BigInt(String(raw.mandate[k])),
      ]),
    ),
  });
  let agent, decimalsB;
  try {
    const d = await loadDeployment(chain);
    const s = await readVault(chain, d.vault);
    agent = s.mandate.agent;
    decimalsB = s.decimalsB;
    const m = s.mandate;
    const { agent: _agent, ...signed } = m;
    void _agent;
    mandate = mandateSchema.parse({
      ...signed,
      expiry: Number(m.expiry),
      minIntervalSec: Number(m.minIntervalSec),
      revoked: s.paused || /^0x0{40}$/i.test(m.agent),
    });
  } catch {
    /* A proposal requiring the agent will fail closed. */
  }
  return {
    receipts,
    portfolio: pnl(results),
    evidence,
    policy: policySchema.parse(raw.policy),
    mandate,
    agent,
    decimalsB,
  };
}
