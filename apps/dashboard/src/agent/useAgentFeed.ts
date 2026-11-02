import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { fixture } from './fixture.js';
import type { AgentFeed } from './feed-types.js';
import {
  fetchFeed,
  feedSchema,
  readFeedJSON,
  selectedChain,
  snapshotFor,
  validateFeedChain,
} from './feed-client.js';
import type { DashboardChain } from '../lib/clients.js';

export type FeedObservation = {
  feed: AgentFeed | null;
  unreachable: boolean;
  connection: 'loading' | 'connected' | 'missing' | 'unreachable';
  provenance: 'live' | 'snapshot' | 'demo' | 'unavailable';
  observedAt?: number;
  error?: string;
};
const FeedContext = createContext<{
  chain: DashboardChain;
  observation: FeedObservation;
} | null>(null);
export function AgentFeedProvider({
  chain,
  children,
}: {
  chain: DashboardChain;
  children: ReactNode;
}) {
  const observation = useAgentFeedSource(chain, true);
  return createElement(
    FeedContext.Provider,
    { value: { chain, observation } },
    children,
  );
}
export function useAgentFeed(
  chain: DashboardChain = selectedChain(),
): FeedObservation {
  const shared = useContext(FeedContext);
  const standalone = useAgentFeedSource(chain, shared?.chain !== chain);
  return shared?.chain === chain ? shared.observation : standalone;
}
function useAgentFeedSource(
  chain: DashboardChain,
  enabled: boolean,
): FeedObservation {
  const demo = new URLSearchParams(window.location.search).get('demo') === '1';
  const [observation, setObservation] = useState<FeedObservation>({
    feed: demo ? fixture : null,
    unreachable: false,
    connection: 'loading',
    provenance: demo ? 'demo' : 'unavailable',
  });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let inFlight = false,
      rerun = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setObservation({
      feed: demo ? fixture : null,
      unreachable: false,
      connection: 'loading',
      provenance: demo ? 'demo' : 'unavailable',
    });
    async function poll() {
      if (demo || !active) return;
      if (inFlight) {
        rerun = true;
        return;
      }
      clearTimeout(timer);
      inFlight = true;
      const base = import.meta.env.VITE_AGENT_FEED_URL;
      const signal = () =>
        AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
      try {
        if (!base) throw Error('VITE_AGENT_FEED_URL is not configured');
        const feed = await fetchFeed(base, signal(), chain);
        if (active)
          setObservation({
            feed,
            unreachable: false,
            connection: 'connected',
            provenance: 'live',
            observedAt: Date.now() / 1000,
          });
      } catch (cause) {
        if (!active) return;
        const failure = {
          unreachable: true,
          connection: base ? ('unreachable' as const) : ('missing' as const),
          error: cause instanceof Error ? cause.message : 'Feed unavailable',
        };
        setObservation((previous) => ({ ...previous, ...failure }));
        try {
          const saved = feedSchema.parse(
            await readFeedJSON('', snapshotFor(chain) + '/feed.json', signal()),
          );
          validateFeedChain(saved.state, chain);
          // Never replace a newer live observation with an old export after a refresh failure.
          if (active)
            setObservation((previous) =>
              previous.provenance === 'live' ||
              (previous.feed &&
                Math.max(
                  previous.feed.state.lastWakeAt ?? 0,
                  ...previous.feed.actions.map((action) => action.at),
                ) >
                  Math.max(
                    saved.state.lastWakeAt ?? 0,
                    ...saved.actions.map((action) => action.at),
                  ))
                ? previous
                : {
                    ...previous,
                    feed: saved,
                    provenance: 'snapshot',
                  },
            );
        } catch {
          /* Retain the last observation with its refresh failure visible. */
        }
      }
      inFlight = false;
      if (active && rerun) {
        rerun = false;
        void poll();
      } else if (active) timer = setTimeout(() => void poll(), 30000);
    }
    const invalidate = () => {
      void poll();
    };
    window.addEventListener('dashboard:reads-invalidated', invalidate);
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('dashboard:reads-invalidated', invalidate);
    };
  }, [chain, demo, enabled]);
  return observation;
}
