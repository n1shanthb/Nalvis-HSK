import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PriceChart from '../src/components/charts/PriceChart.js';
import BasisChart from '../src/components/charts/BasisChart.js';
import VaultChart from '../src/components/charts/VaultChart.js';
import TimeSeries from '../src/components/charts/TimeSeriesChart.js';
import { LimitChart } from '../src/components/charts/LimitChart.js';
import { CostChart } from '../src/components/charts/CostChart.js';
import { demoEvidence, demoContext } from '../src/lib/demo.js';
import { sources } from '../src/lib/chart-data.js';
import { units } from '../../../packages/core/src/policy.js';
import type { AgentFeed } from '../src/agent/feed-types.js';
const api = vi.hoisted(() => ({
  setData: vi.fn(),
  update: vi.fn(),
  setMarkers: vi.fn(),
  createPriceLine: vi.fn<(line: { title: string; price: number }) => object>(
    () => ({}),
  ),
  removePriceLine: vi.fn(),
  remove: vi.fn(),
  applyOptions: vi.fn(),
  fitContent: vi.fn(),
  addLineSeries: vi.fn(),
}));
vi.mock('lightweight-charts', () => ({
  LineStyle: { Dashed: 2 },
  createChart: () => ({
    ...api,
    addLineSeries: () => api,
    timeScale: () => ({ fitContent: api.fitContent }),
  }),
}));
beforeEach(() => {
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
describe('honest accessible charts', () => {
  it('renders recorded badges on live failure, never DEMO, with keyboard data access', async () => {
    render(
      <>
        <PriceChart points={[]} unavailable />
        <BasisChart unavailable />
      </>,
    );
    expect(
      screen.getAllByText(/Live data unavailable/, { selector: 'p' }),
    ).toHaveLength(2);
    expect(screen.getAllByText(sources.recorded).length).toBeGreaterThan(1);
    expect(screen.queryByText(sources.demo)).toBeNull();
    expect(
      screen
        .getAllByRole('img')
        .every((x) => x.hasAttribute('aria-label') && x.tabIndex === 0),
    ).toBe(true);
    expect(screen.getAllByText(/Show data/)).toHaveLength(2);
    await waitFor(() => expect(api.setData).toHaveBeenCalled());
  });
  it('shows DEMO on every local recording chart and exposes receipt data', async () => {
    window.history.replaceState(null, '', '?demo=1#/agent');
    const c = await demoContext();
    render(
      <>
        <PriceChart points={demoEvidence} demo />
        <BasisChart points={demoEvidence} demo />
        <LimitChart
          source={sources.demo}
          mandate={c.mandate}
          evidence={c.evidence}
        />
        <VaultChart results={c.results} demo />
      </>,
    );
    expect(screen.getAllByText(sources.demo)).toHaveLength(4);
    expect(screen.getAllByRole('img')).toHaveLength(4);
    window.history.replaceState(null, '', '/');
  });
  it('updates the live series on an evidence poll and removes its chart', async () => {
    const first = demoEvidence.find((e) => e.dexMid && e.cex.length === 2)!;
    const view = render(<PriceChart points={[first]} demo />);
    await waitFor(() => expect(api.createPriceLine).toHaveBeenCalled());
    view.rerender(
      <PriceChart
        points={[
          first,
          { ...first, now: first.now + 30, dexMid: first.dexMid! * 1.001 },
        ]}
        demo
      />,
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({ time: first.now + 30 }),
      ),
    );
    expect(
      api.createPriceLine.mock.calls.every(
        ([line]) => line.title === 'APRO reference',
      ),
    ).toBe(true);
    expect(api.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({
        price: first.apro!.price,
        title: 'APRO reference',
      }),
    );

    view.unmount();
    expect(api.remove).toHaveBeenCalledOnce();
  });
  it.each([true, false])(
    'uses weight-band text and never draws price bands (APRO present: %s)',
    async (aproPresent) => {
      const c = await demoContext();
      const first = demoEvidence.find((e) => e.dexMid && e.cex.length === 2)!;
      const point = {
        ...first,
        apro: aproPresent ? first.apro : undefined,
        vault: {
          balanceA: 0n,
          balanceB: 100n,
          decimalsA: first.decimalsA,
          decimalsB: first.decimalsB,
          mandate: c.mandate,
        },
      };
      const view = render(<PriceChart points={[point]} demo />);
      await waitFor(() => expect(api.setData).toHaveBeenCalled());
      expect(
        screen.getByText(
          /Outside band · Weight A 0.00% vs target 50.00% ± 5.00 percentage points/,
        ),
      ).toBeTruthy();
      expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
        'Weight A 0.00% vs target 50.00% ± 5.00 percentage points',
      );
      expect(
        screen.getAllByRole('columnheader').map((h) => h.textContent),
      ).toEqual(['Time (IST)', 'DEX / USDT', 'CEX / USDT', 'Basis %']);
      fireEvent.change(screen.getByLabelText('Policy reference preset'), {
        target: { value: 'conservative' },
      });
      expect(
        screen.getByText(
          /Outside band · Weight A 0.00% vs target 40.00% ± 7.50 percentage points/,
        ),
      ).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Policy reference preset'), {
        target: { value: 'balanced' },
      });
      view.rerender(
        <PriceChart
          points={[
            {
              ...point,
              vault: {
                ...point.vault,
                balanceA: 10n ** BigInt(first.decimalsA),
                balanceB: units(first.dexMid!, first.decimalsB),
              },
            },
          ]}
          demo
        />,
      );
      expect(
        screen.getByText(
          /Inside band · Weight A 50.00% vs target 50.00% ± 5.00 percentage points/,
        ),
      ).toBeTruthy();
      view.rerender(
        <PriceChart
          points={[
            { ...point, vault: { ...point.vault, balanceA: 0n, balanceB: 0n } },
          ]}
          demo
        />,
      );
      expect(
        screen.getByText(
          /Engine band state unavailable · Weight A unavailable/,
        ),
      ).toBeTruthy();
      if (aproPresent)
        expect(
          api.createPriceLine.mock.calls.every(
            ([line]) => line.title === 'APRO reference',
          ),
        ).toBe(true);
      else expect(api.createPriceLine).not.toHaveBeenCalled();
      expect(
        screen.queryByText(
          /Lower price reference|Upper price reference|around CEX mid/,
        ),
      ).toBeNull();
    },
  );
  it('preserves a missing interval when observations arrive after the recorded seed', () => {
    const view = render(
      <TimeSeries
        series={[
          { name: 'DEX', color: 'blue', points: [{ time: 100, value: 1 }] },
        ]}
      />,
    );
    view.rerender(
      <TimeSeries
        series={[
          {
            name: 'DEX',
            color: 'blue',
            points: [
              { time: 100, value: 1 },
              { time: 10000, value: 2 },
            ],
          },
        ]}
      />,
    );
    expect(api.update).toHaveBeenCalledWith({ time: 101 });
    expect(api.update).toHaveBeenCalledWith({ time: 10000, value: 2 });
  });
  it('cleans up ResizeObserver and chart on unmount', () => {
    const disconnect = vi.fn(),
      observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    const view = render(
      <TimeSeries
        series={[
          { name: 'test', color: 'blue', points: [{ time: 1, value: 2 }] },
        ]}
      />,
    );
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(api.remove).toHaveBeenCalledOnce();
  });
  it('labels live limit and cost charts and sets the reference to the supplied budget', () => {
    const feed = {
      state: {
        mode: 'live',
        state: 'budget_paused',
        lastWakeAt: 1793448000,
        spendTodayUsd: 0.6,
        budgetUsd: 0.75,
        llmCallsToday: 3,
      },
    } as AgentFeed;
    render(
      <>
        <LimitChart />
        <CostChart feed={feed} />
      </>,
    );
    expect(screen.getAllByText(sources.execution)).toHaveLength(2);
    expect(
      screen.getByTestId('budget-reference').getAttribute('data-budget'),
    ).toBe('.75'.replace(/^\./, '0.'));
    expect(screen.getByText('budget_paused')).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
  it('does not replace unavailable live cost or vault observations with demo', () => {
    render(
      <>
        <CostChart feed={null} />
        <VaultChart />
      </>,
    );
    expect(screen.queryByText(sources.demo)).toBeNull();
    expect(
      screen.getAllByText(/Live data unavailable/, { selector: 'p' }),
    ).toHaveLength(2);
  });
});
