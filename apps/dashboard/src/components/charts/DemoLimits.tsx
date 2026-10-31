import { useCallback } from 'react';
import { demoContext } from '../../lib/demo.js';
import { useResource } from '../../lib/useResource.js';
import { LimitChart } from './LimitChart.js';
import { sources } from '../../lib/chart-data.js';
export function DemoLimits() {
  const r = useResource(useCallback(demoContext, []));
  const c = r.data,
    e = c?.evidence;
  // These are recorded pre-decision engine inputs, not estimates of today's usage.
  const state = e?.sources.replay?.raw as
    { state?: { dailySpentB?: string; lastTradeAt?: number } } | undefined;
  return (
    <LimitChart
      mandate={c?.mandate}
      evidence={e}
      source={sources.demo}
      at={e?.now}
      dailySpentB={
        state?.state?.dailySpentB !== undefined && e
          ? Number(state.state.dailySpentB) / 10 ** e.decimalsB
          : undefined
      }
      lastTradeAt={state?.state?.lastTradeAt}
    />
  );
}
