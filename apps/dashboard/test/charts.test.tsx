import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PriceChart from '../src/components/charts/PriceChart.js';
import BasisChart from '../src/components/charts/BasisChart.js';
import VaultChart from '../src/components/charts/VaultChart.js';
import TimeSeries from '../src/components/charts/TimeSeriesChart.js';
import { LimitChart } from '../src/components/charts/LimitChart.js';
import { CostChart } from '../src/components/charts/CostChart.js';
import { demoEvidence, demoContext } from '../src/lib/demo.js';
import { sources } from '../src/lib/chart-data.js';
import type { AgentFeed } from '../src/agent/feed-types.js';
const api = vi.hoisted(() => ({
  setData: vi.fn(),
  update: vi.fn(),
  setMarkers: vi.fn(),
  createPriceLine: vi.fn(() => ({})),
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
    expect(screen.getAllByText(/Live data unavailable/)).toHaveLength(2);
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
    expect(api.createPriceLine.mock.calls.length).toBeGreaterThanOrEqual(2);
    view.unmount();
    expect(api.remove).toHaveBeenCalledOnce();
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
    expect(screen.getAllByText(/Live data unavailable/)).toHaveLength(2);
  });
});
