import { ConnectLedger } from '../owner/ConnectLedger.js';
export function Header({
  demo,
  onDesk,
}: {
  demo: boolean;
  onDesk: () => void;
}) {
  return (
    <header className="ux-header">
      <a className="wordmark" href="#/home">
        NALVIS
      </a>
      <nav aria-label="Dashboard views">
        {['Mandate', 'Agent', 'Verify'].map((label) => (
          <a key={label} href={`#/${label.toLowerCase()}`}>
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
      <button onClick={onDesk}>AI desk</button>
      <ConnectLedger />
    </header>
  );
}
