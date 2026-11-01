const steps = [
  [
    'Connect Ledger',
    'Unlock the device and open the Ethereum app. Owner authority stays on hardware.',
  ],
  [
    'Choose a preset',
    'Conservative, balanced or patient. Select the policy reference that fits your mandate.',
  ],
  [
    'Set the boundaries',
    'Review trade size, daily spend, exposure, slippage and expiry.',
  ],
  [
    'Review & sign',
    'Inspect the destination, calldata and hash. Ledger blind signing on testnet 133.',
  ],
  [
    'Agent watches',
    'Evidence and watches inform proposals. Deterministic checks enforce the mandate.',
  ],
  [
    'Bounded execution',
    'TRADE, RESIZE, WAIT or REJECT. Testnet execution; no real funds.',
  ],
  [
    'Verify the trail',
    'Replay evidence, bind the transaction and inspect the hash-chained receipt.',
  ],
];
export function Landing() {
  const scroll = (id: string) =>
    document
      .getElementById(id)
      ?.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')
          .matches
          ? 'auto'
          : 'smooth',
      });
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="wordmark" href="#/home">
          NALVIS
        </a>
        <nav aria-label="Landing navigation">
          <button className="text-action" onClick={() => scroll('workflow')}>
            How it works
          </button>
          <button className="text-action" onClick={() => scroll('proof')}>
            Recorded proof
          </button>
          <a href="#/overview">Overview</a>
        </nav>
        <a className="button" href="#/setup">
          Set mandate
        </a>
      </header>
      <main className="landing-main">
        <section className="landing-hero">
          <p className="hero-tag">NALVIS / BOUNDED EXECUTION</p>
          <h1>Ledger-governed execution for autonomous DeFi.</h1>
          <p className="hero-description">
            Give your agent a signed mandate. Keep control of trade size,
            exposure and risk. Every decision carries the evidence and a receipt
            you can independently verify.
          </p>
          <div className="hero-actions">
            <a className="button" href="#/overview">
              Open live console
            </a>
            <a className="button ghost" href="?demo=1#/overview">
              Watch recorded demo →
            </a>
          </div>
          <p className="hero-footnote">
            HashKey Chain · mainnet evidence read-only · testnet execution
          </p>
        </section>
        <section id="workflow" className="landing-section">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>Seven steps from owner authority to a verifiable outcome.</h2>
          <ol className="workflow-grid">
            {steps.map(([title, description], i) => (
              <li key={title}>
                <article>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              </li>
            ))}
          </ol>
        </section>
        <section id="protocol" className="landing-section">
          <p className="eyebrow">WHY IT MATTERS</p>
          <h2>
            Boundaries on device. Decisions with evidence. Outcomes you can
            verify.
          </h2>
          <div className="pillars-grid">
            <article>
              <h3>01 / Owner authority</h3>
              <p>
                Ledger-signed caps and expiry define what the agent can do.
                Revoke authority at any time.
              </p>
            </article>
            <article>
              <h3>02 / Bounded autonomy</h3>
              <p>
                Strategist and Fitter can propose. Deterministic checks remain
                authoritative. No language model signs or sends transactions.
              </p>
            </article>
            <article>
              <h3>03 / Receipt-backed proof</h3>
              <p>
                Evidence, rule traces and hash-chained receipts make TRADE,
                RESIZE, WAIT and REJECT inspectable.
              </p>
            </article>
          </div>
        </section>
        <section id="proof" className="landing-section">
          <p className="eyebrow">RECORDED LOCAL ANVIL</p>
          <h2>Inspect the evidence. Replay the outcome.</h2>
          <p>
            Genuine local transaction recordings with synthetic market
            scenarios. Offline RPC replay, not a live network demonstration.
          </p>
          <div className="proof-links">
            <a href="?demo=1#/activity">
              Decision receipts →
              <small>RECORDED LOCAL EXECUTION · PRICES NOT REAL</small>
            </a>
            <a href="?demo=1#/verify">
              Independent verification →
              <small>HASHES · TRANSACTION BINDING · CHAIN LINKS</small>
            </a>
            <a href="#/evidence">
              Market evidence →
              <small>MAINNET 177 · READ-ONLY OBSERVATIONS</small>
            </a>
            <a className="live-console-link" href="?demo=0#/mandate">
              Live console / Connect Ledger
              <small>TESTNET 133 · LEDGER BLIND SIGNING</small>
            </a>
          </div>
          <a className="button" href="?demo=1#/overview">
            Explore recorded workspace
          </a>
          <p className="hero-footnote">
            No proven trading edge. Bounded, provable execution.
          </p>
        </section>
      </main>
      <footer className="landing-footer">
        <a className="wordmark" href="#/home">
          NALVIS
        </a>
        <span>
          Owner authority stays on Ledger. Mainnet evidence is read-only.
          Testnet and local Anvil prices are not real.
        </span>
        <a href="#/agent">Agent room</a>
      </footer>
    </div>
  );
}
