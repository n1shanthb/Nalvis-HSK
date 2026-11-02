import { useEffect, useState } from 'react';
import type { FeedObservation } from '../agent/useAgentFeed.js';
import { displayTime } from '../lib/clients.js';
export function FeedStatus({ observation }: { observation: FeedObservation }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(timer);
  }, []);
  const { feed, connection, provenance, observedAt, error } = observation;
  const lastWake = feed?.state.lastWakeAt;
  const nextWake = feed?.state.nextWakeAt;
  const feedStale =
    provenance === 'live' &&
    (connection !== 'connected' ||
      observedAt == null ||
      now - observedAt > 120);
  return (
    <aside
      className="feed-status"
      role="status"
      aria-label="Agent feed provenance"
    >
      <p>
        {provenance === 'demo'
          ? 'Offline demo — no live feed requests.'
          : connection === 'missing'
            ? 'Missing configuration: VITE_AGENT_FEED_URL.'
            : connection === 'unreachable'
              ? 'Configured feed unavailable.'
              : connection === 'connected'
                ? 'Read-only feed connected.'
                : 'Checking agent feed.'}
      </p>
      <p>
        {provenance === 'live'
          ? 'Last live observation'
          : provenance === 'snapshot'
            ? 'Recorded snapshot — not live'
            : provenance === 'demo'
              ? 'DEMO fixture — not live'
              : 'No live or recorded observation available'}
        {observedAt ? ` · fetched ${displayTime(observedAt)}` : ''}
      </p>
      {lastWake != null && (
        <p>
          Last agent wake: {displayTime(lastWake)}
          {feedStale
            ? ' · Stale last observation; live feed freshness is unavailable.'
            : provenance === 'live' && nextWake != null && now > nextWake + 120
              ? ' · Scheduled wake overdue by more than 2 minutes.'
              : ''}
        </p>
      )}
      {nextWake != null && <p>Next scheduled wake: {displayTime(nextWake)}</p>}
      {error && (
        <details>
          <summary>Feed diagnostics</summary>
          <p>{error}</p>
          <p>
            The dashboard needs a browser-reachable read-only feed or an
            exported snapshot. VM loopback is not publicly reachable. Host and
            network configuration require the infrastructure owner.
          </p>
        </details>
      )}
    </aside>
  );
}
