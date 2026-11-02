import { useCallback, useEffect, useRef, useState } from 'react';
/** Read invalidation only; never remount owner review or modify signing state. */
export const invalidateReads = () =>
  window.dispatchEvent(new Event('dashboard:reads-invalidated'));
export function useResource<T>(load: () => Promise<T>, interval = 30000) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    cause?: unknown;
    loading: boolean;
  }>({ loading: true });
  const refresh = useRef<() => Promise<void>>(async () => {});
  const reload = useCallback(() => refresh.current(), []);
  useEffect(() => {
    let active = true,
      inFlight = false,
      rerun = false;
    let timer: ReturnType<typeof setTimeout>;
    setState({ loading: true });
    async function poll() {
      if (!active) return;
      if (inFlight) {
        rerun = true;
        return;
      }
      clearTimeout(timer);
      inFlight = true;
      try {
        const data = await load();
        if (active) setState({ data, loading: false });
      } catch (cause) {
        if (active)
          setState((previous) => ({
            ...previous,
            cause,
            error: cause instanceof Error ? cause.message : 'Unavailable',
            loading: false,
          }));
      } finally {
        inFlight = false;
        if (active && rerun) {
          rerun = false;
          void poll();
        } else if (active) timer = setTimeout(poll, Math.max(interval, 30000));
      }
    }
    refresh.current = poll;
    const invalidate = () => {
      void poll();
    };
    window.addEventListener('dashboard:reads-invalidated', invalidate);
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('dashboard:reads-invalidated', invalidate);
    };
  }, [load, interval]);
  return { ...state, reload };
}
