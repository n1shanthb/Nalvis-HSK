import { useCallback } from 'react';
import { zeroAddress } from 'viem';
import { demoContext, demoReceipts } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
import { MandateWizard } from './MandateWizard.js';
export function DemoMandate() {
  const resource = useResource(useCallback(demoContext, []));
  if (!resource.data) return <p>Loading recorded mandate…</p>;
  const m = resource.data.mandate;
  return (
    <section>
      <h2>Recorded mandate preview</h2>
      <p>Owner unavailable in this recording. Signing disabled.</p>
      <MandateWizard
        chain={133}
        vault={demoReceipts[0].contract}
        previewOnly
        snapshot={{
          owner: zeroAddress,
          paused: false,
          blockNumber: 0n,
          decimalsA: 18,
          decimalsB: 6,
          mandate: {
            maxTradeInA: m.maxTradeInA,
            maxTradeInB: m.maxTradeInB,
            maxDailyInB: m.maxDailyInB,
            maxExposureBps: m.maxExposureBps,
            maxSlippageBps: m.maxSlippageBps,
            agent: resource.data.agent,
            expiry: BigInt(m.expiry),
            minIntervalSec: BigInt(m.minIntervalSec),
            maxDrawdownBps: m.maxDrawdownBps ?? 0,
            policyHash: m.policyHash as `0x${string}`,
          },
        }}
      />
    </section>
  );
}
