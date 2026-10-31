import { ConnectLedger } from '../owner/ConnectLedger.js';
export function Header({
  demo,
  onDesk,
  activeRoute,
}: {
  demo: boolean;
  onDesk: () => void;
  activeRoute?: string;
}) {
  return (
    <header className="ux-header">
      <a className="wordmark" href="#/home">
        NALVIS
      </a>
      <nav aria-label="Dashboard views">
        {['Mandate', 'Agent', 'Verify'].map((label) => (
          <a
            aria-current={
              activeRoute === label.toLowerCase() ? 'page' : undefined
            }
            key={label}
            href={`#/${label.toLowerCase()}`}
          >
            {label}
          </a>
        ))}
      </nav>
      <span className="badge">
        {demo ? 'Recorded demo 31337' : 'Testnet 133'}
      </span>
      <a href={demo ? '?#/agent' : '?demo=1#/agent'}>
        {demo ? 'Switch to Live' : 'Watch Demo'}
      </a>
      <button data-desk-trigger onClick={onDesk}>
        AI desk
      </button>
      {!demo && <ConnectLedger />}
    </header>
  );
}
