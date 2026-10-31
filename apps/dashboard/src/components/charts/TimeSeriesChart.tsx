import { useEffect, useRef, useState } from 'react';
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
  const [selected, setSelected] = useState<Marker>();
  const markerRef = useRef(markers);
  markerRef.current = markers;
  const divider = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | undefined>(undefined);
  const handles = useRef<ISeriesApi<'Line'>[]>([]);
  const previous = useRef<Point[][]>([]);
  useEffect(() => {
    if (!host.current || typeof window.CanvasRenderingContext2D === 'undefined')
      return;
    const c = createChart(host.current, {
      height: 220,
      width: host.current.clientWidth || 320,
      layout: { background: { color: 'transparent' }, textColor: '#8b9199' },
      timeScale: { timeVisible: true },
      handleScroll: !window.matchMedia?.('(prefers-reduced-motion: reduce)')
        .matches,
    });
    chart.current = c;
    c.subscribeClick?.((event) => {
      const marker = markerRef.current.find(
        (m) => m.id === event.hoveredObjectId,
      );
      setSelected(marker);
    });
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
          s.points.flatMap((p, j) => [
            ...(j && p.time - s.points[j - 1].time > 5400
              ? [{ time: (s.points[j - 1].time + 1) as UTCTimestamp }]
              : []),
            { ...p, time: p.time as UTCTimestamp },
          ]),
        );
    });
    if (previous.current.every((rows) => !rows.length))
      chart.current?.timeScale().fitContent();
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
    return () => {
      if (chart.current) added.forEach((l) => api.removePriceLine(l));
    };
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
  useEffect(() => {
    const scale = chart.current?.timeScale();
    if (!scale || !liveFrom || !divider.current) return;
    const position = () => {
      const x = scale.timeToCoordinate?.(liveFrom as UTCTimestamp);
      if (divider.current) {
        divider.current.style.display = x == null ? 'none' : 'block';
        divider.current.style.left = `${x ?? 0}px`;
      }
    };
    position();
    scale.subscribeVisibleTimeRangeChange?.(position);
    return () => {
      if (chart.current) scale.unsubscribeVisibleTimeRangeChange?.(position);
    };
  }, [liveFrom, series]);
  return (
    <>
      <div className="time-series-host">
        <div ref={host} aria-hidden="true" />
        {liveFrom && (
          <div className="live-divider" ref={divider} aria-hidden="true">
            Live from here
          </div>
        )}
      </div>
      {selected && (
        <p role="status">
          {selected.text} ·{' '}
          {selected.href ? (
            <a href={selected.href}>Inspect receipt</a>
          ) : (
            'No receipt available'
          )}
        </p>
      )}
    </>
  );
}
