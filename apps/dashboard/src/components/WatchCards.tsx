import type { WatchView } from '../agent/feed-types.js';
import { displayTime } from '../lib/clients.js';

function watchName(watch: WatchView) {
  const split = watch.label.indexOf(':');
  return split === -1
    ? { kind: watch.kind.replaceAll('_', ' '), title: watch.label }
    : {
        kind: watch.label.slice(0, split).replaceAll('_', ' '),
        title: watch.label.slice(split + 1).trim(),
      };
}

export function WatchCards({
  watches,
  compact = false,
}: {
  watches: WatchView[];
  compact?: boolean;
}) {
  if (!watches.length) return <p>No active watches supplied in the feed.</p>;
  return (
    <div className={`watch-card-grid${compact ? ' compact' : ''}`}>
      {watches.map((watch) => {
        const name = watchName(watch);
        const noteRepeatsTitle =
          watch.note.trim().toLowerCase() === name.title.toLowerCase();
        return (
          <article className="watch-card" key={watch.id}>
            <header>
              <span className="watch-kind">{name.kind}</span>
              <span className={watch.fireCount ? 'watch-fired' : 'watch-armed'}>
                {watch.fireCount ? `Triggered ${watch.fireCount}×` : 'Watching'}
              </span>
            </header>
            <h4>{name.title}</h4>
            {!noteRepeatsTitle && <p>{watch.note}</p>}
            <dl className="watch-meta">
              <div>
                <dt>Source</dt>
                <dd>{watch.createdBy}</dd>
              </div>
              {!compact && (
                <div>
                  <dt>Created</dt>
                  <dd>{displayTime(watch.createdAt)}</dd>
                </div>
              )}
              <div>
                <dt>Last fired</dt>
                <dd>
                  {watch.lastFiredAt ? displayTime(watch.lastFiredAt) : 'Never'}
                </dd>
              </div>
              {!compact && (
                <div>
                  <dt>Expires</dt>
                  <dd>
                    {watch.expiresAt
                      ? displayTime(watch.expiresAt)
                      : 'Not scheduled'}
                  </dd>
                </div>
              )}
            </dl>
          </article>
        );
      })}
    </div>
  );
}
