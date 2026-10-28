import { useEffect, useState } from 'react';
export function useResource<T>(load: () => Promise<T>, interval = 30000) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await load();
        if (active) setState({ data, loading: false });
      } catch (e) {
        if (active)
          setState({
            error: e instanceof Error ? e.message : 'Unavailable',
            loading: false,
          });
      }
      if (active) timer = setTimeout(poll, Math.max(interval, 30000));
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load, interval]);
  return state;
}
