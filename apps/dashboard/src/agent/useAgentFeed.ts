import { useEffect, useState } from 'react';
import { fixture } from './fixture.js';
import type { AgentFeed } from './feed-types.js';
import {
  fetchFeed,
  feedSchema,
  readFeedJSON,
  snapshotBase,
} from './feed-client.js';
export function useAgentFeed(): {
  feed: AgentFeed | null;
  unreachable: boolean;
} {
  const [feed, setFeed] = useState<AgentFeed | null>(() =>
      new URLSearchParams(window.location.search).get('demo') === '1'
        ? fixture
        : null,
    ),
    [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>,
      failures = 0;
    const controller = new AbortController();
    const demo =
      new URLSearchParams(window.location.search).get('demo') === '1';
    async function poll() {
      if (demo) return;
      try {
        const base = import.meta.env.VITE_AGENT_FEED_URL;
        if (!base) throw Error('No feed URL');
        const next = await fetchFeed(
          base,
          AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        );
        if (live) {
          setFeed(next);
          setUnreachable(false);
        }
        failures = 0;
      } catch {
        failures++;
        if (live) setUnreachable(true);
        try {
          const saved = feedSchema.parse(
            await readFeedJSON(
              '',
              snapshotBase + '/feed.json',
              AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
            ),
          );
          if (saved.state.mode !== 'live')
            throw Error('No production demo data');
          if (
            import.meta.env.VITE_EXECUTION_CHAIN === '177' &&
            saved.state.executionChainId !== 177
          )
            throw Error('Snapshot execution chain mismatch');
          if (live) setFeed(saved);
        } catch {
          if (live) setFeed(null);
        }
      }
      if (live)
        timer = setTimeout(
          () => void poll(),
          Math.min(120000, 10000 * 2 ** Math.min(failures, 4)),
        );
    }
    void poll();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return { feed, unreachable };
}
