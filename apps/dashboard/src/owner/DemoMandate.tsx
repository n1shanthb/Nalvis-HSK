import { displayTime } from '../lib/clients.js';
import { formatUnits } from 'viem';
import { DemoLimits } from '../components/charts/DemoLimits.js';
import { useCallback } from 'react';
import { zeroAddress } from 'viem';
import { demoContext, demoReceipts } from '../lib/demo.js';
import { useResource } from '../lib/useResource.js';
import { MandateWizard } from './MandateWizard.js';
export function DemoMandate({ setup = false }: { setup?: boolean }) {
  const resource = useResource(useCallback(demoContext, []));
  if (!resource.data) return <p>Loading recorded mandate…</p>;
  const m = resource.data.mandate;
  if (!setup)
    return (
      <section>
        <p className="eyebrow">MANDATE / RECORDED LOCAL ANVIL</p>
        <h1>Recorded mandate preview</h1>
        <p>
          Historical authority and limits from the recorded execution. Owner
          unavailable in this recording. Signing disabled.
        </p>
        <DemoLimits />
        <dl>
          <div>
            <dt>Agent</dt>
            <dd>
              <code>{resource.data.agent}</code>
            </dd>
          </div>
          <div>
            <dt>Expiry · historical</dt>
            <dd>{displayTime(m.expiry)}</dd>
          </div>
          <div>
            <dt>USDT per trade</dt>
            <dd>
              {formatUnits(m.maxTradeInB, resource.data.evidence.decimalsB)}
            </dd>
          </div>
          <div>
            <dt>USDT per UTC day</dt>
            <dd>
              {formatUnits(m.maxDailyInB, resource.data.evidence.decimalsB)}
            </dd>
          </div>
          <div>
            <dt>Policy commitment</dt>
            <dd>
              <code>{m.policyHash}</code>
            </dd>
          </div>
        </dl>
        <a className="button" href="#/setup">
          Explore mandate setup
        </a>
      </section>
    );
  return (
    <section>
      <p className="eyebrow">SET MANDATE / RECORDED PREVIEW</p>
      <h1>Define your execution boundaries</h1>
      <p>
        Explore the mandate journey using a recorded fixture. This preview
        cannot sign or submit transactions.
      </p>
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
