import { useEffect, useRef } from 'react';
import {
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Point } from '../../lib/chart-data.js';
export type Series = { name: string; color: string; points: Point[] };
export type Marker = {
  time: number;
  position: 'aboveBar';
  shape: 'arrowUp' | 'arrowDown' | 'square' | 'circle';
  color: string;
  text: string;
  id?: string;
  href?: string;
};
export default function TimeSeriesChart({
  series,
  lines = [],
  markers = [],
  liveFrom,
}: {
  series: Series[];
  lines?: { value: number; title: string }[];
  markers?: Marker[];
  liveFrom?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | undefined>(undefined);
  const handles = useRef<ISeriesApi<'Line'>[]>([]);
  const previous = useRef<Point[][]>([]);
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      height: 220,
      width: host.current.clientWidth || 320,
      layout: { background: { color: 'transparent' }, textColor: '#8b9199' },
      timeScale: { timeVisible: true },
      handleScroll: !window.matchMedia?.('(prefers-reduced-motion: reduce)')
        .matches,
    });
    chart.current = c;
    handles.current = series.map((s) =>
      c.addLineSeries({ color: s.color, title: s.name, lineWidth: 2 }),
    );
    const resize =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() =>
            c.applyOptions({ width: host.current?.clientWidth || 320 }),
          )
        : undefined;
    resize?.observe(host.current);
    return () => {
      resize?.disconnect();
      c.remove();
      chart.current = undefined;
      previous.current = [];
    };
    // Series identities are fixed for each chart instance; polls only update observations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    series.forEach((s, i) => {
      const api = handles.current[i];
      if (!api) return;
      const prev = previous.current[i];
      const append =
        prev?.length &&
        s.points.length >= prev.length &&
        prev.every(
          (p, j) =>
            p.time === s.points[j].time && p.value === s.points[j].value,
        );
      if (append)
        s.points
          .slice(prev.length)
          .forEach((p) => api.update({ ...p, time: p.time as UTCTimestamp }));
      else
        api.setData(
          s.points.map((p) => ({ ...p, time: p.time as UTCTimestamp })),
        );
    });
    if (!previous.current.length) chart.current?.timeScale().fitContent();
    previous.current = series.map((s) => s.points);
  }, [series]);
  useEffect(() => {
    const api = handles.current[0];
    if (!api) return;
    const added = lines.map((l) =>
      api.createPriceLine({
        price: l.value,
        title: l.title,
        color: '#8b9199',
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
      }),
    );
    return () => added.forEach((l) => api.removePriceLine(l));
  }, [lines]);
  useEffect(() => {
    handles.current[0]?.setMarkers(
      [
        ...markers,
        ...(liveFrom
          ? [
              {
                time: liveFrom,
                position: 'belowBar' as const,
                shape: 'arrowUp' as const,
                color: '#75baff',
                text: 'Live from here',
              },
            ]
          : []),
      ]
        .sort((a, b) => a.time - b.time)
        .map((m) => ({ ...m, time: m.time as UTCTimestamp })),
    );
  }, [markers, liveFrom]);
  return <div ref={host} aria-hidden="true" />;
}
