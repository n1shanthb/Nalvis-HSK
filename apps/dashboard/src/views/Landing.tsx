import { lazy, Suspense } from 'react';
const Preview = lazy(() => import('./LandingPreview.js'));
export function Landing() {
  const scroll = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="wordmark" href="#/home">
          <span className="brand-mark">N</span>NALVIS
          <span className="wordmark-dot">•</span>
        </a>
        <nav aria-label="Landing navigation">
          <button onClick={() => scroll('protocol')}>The protocol</button>
          <button onClick={() => scroll('workflow')}>How it works</button>
          <a href="#/verify">Audit trail ↗</a>
        </nav>
        <a className="live-console-link" href="?demo=0#/mandate">
          Live console / Connect Ledger
        </a>
        <a className="button ember small" href="#/agent">
          Open live console <span>↗</span>
        </a>
      </header>
      <main className="landing-main">
        <section className="landing-hero">
          <div className="orbit-scene" aria-hidden="true">
            <div className="orbit-halo" />
            <div className="orbit-edge" />
            <div className="orbit-planet" />
            <div className="orbit-star star-one" />
            <div className="orbit-star star-two" />
          </div>
          <div className="hero-content">
            <p className="hero-tag">
              <span /> AUTONOMOUS BY DESIGN. BOUNDED BY YOU.
            </p>
            <h1>
              Give your agent freedom.
              <br />
              <span>Keep the final say.</span>
            </h1>
            <p className="hero-description">
              A trading agent with a signed mandate, evidence behind every
              decision, and a trail you can verify. Built for HashKey Chain.
            </p>
            <div className="hero-actions">
              <a className="button ember" href="#/agent">
                Open live console <span>↗</span>
              </a>
              <a className="button ghost" href="?demo=1#/agent">
                Watch recorded demo <span>↗</span>
              </a>
            </div>
            <p className="hero-footnote">
              <span className="tiny-dot" /> Mainnet evidence · bounded testnet
              execution · no proven edge
            </p>
          </div>
        </section>
        <section
          className="preview-stage"
          aria-label="Recorded console preview"
        >
          <div className="preview-glow" />
          <div className="preview-window">
            <div className="window-chrome">
              <span className="window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>THE NALVIS CONSOLE</span>
              <span className="preview-status">
                <i /> RECORDED LOCAL ANVIL
              </span>
            </div>
            <Suspense
              fallback={
                <div className="skeleton">Loading recorded evidence…</div>
              }
            >
              <Preview />
            </Suspense>
          </div>
          <div className="preview-caption">
            <span>REAL RECEIPTS. RECORDED LOCAL EXECUTION.</span>
            <a href="?demo=1#/verify">Verify for yourself ↗</a>
          </div>
        </section>
        <section className="protocol-section" id="protocol">
          <div>
            <p className="landing-eyebrow">01 / THE CONTROL LAYER</p>
            <h2>
              Trust the boundaries.
              <br />
              <span>Inspect everything else.</span>
            </h2>
            <p>
              Autonomy should come with an envelope. Nalvis separates what an
              agent can suggest from what it is allowed to execute.
            </p>
            <a className="text-link" href="#/agent">
              Inspect the signed mandate ↗
            </a>
          </div>
          <div className="protocol-list">
            <article>
              <span>↗</span>
              <div>
                <h3>Authority you can revoke</h3>
                <p>
                  Ledger-signed caps, slippage and expiry. Owner control stays
                  outside the language model.
                </p>
              </div>
            </article>
            <article>
              <span>⌁</span>
              <div>
                <h3>Evidence before execution</h3>
                <p>
                  DEX and CEX observations, measured costs, data quality gates
                  and ±σ worst-case stress.
                </p>
              </div>
            </article>
            <article>
              <span>◇</span>
              <div>
                <h3>A receipt for every decision</h3>
                <p>
                  TRADE, WAIT, RESIZE or REJECT. Hash-chained evidence makes
                  each outcome inspectable.
                </p>
              </div>
            </article>
          </div>
        </section>
        <section className="workflow-section" id="workflow">
          <div className="section-heading">
            <p className="landing-eyebrow">02 / FROM INTENT TO PROOF</p>
            <h2>Three steps. One visible trail.</h2>
          </div>
          <div className="workflow-grid">
            <article>
              <span>01</span>
              <h3>Define your envelope.</h3>
              <p>
                The owner reviews and signs the mandate. The agent receives a
                scope, not unlimited authority.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Let the evidence decide.</h3>
              <p>
                The deterministic engine checks freshness, costs and limits. The
                desk helps explain what happened.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Verify the outcome.</h3>
              <p>
                Replay the evidence and compare it to the receipt. No trust in a
                black-box explanation required.
              </p>
            </article>
          </div>
        </section>
        <section className="landing-final">
          <div className="final-glow" />
          <p className="landing-eyebrow">AUTONOMY, WITH A PAPER TRAIL.</p>
          <h2>
            Every decision.
            <br />
            Accounted for.
          </h2>
          <a className="button ember" href="#/agent">
            Open live console ↗
          </a>
          <p>Local Anvil prices are not real. No proven trading edge.</p>
        </section>
      </main>
      <footer className="landing-footer">
        <a className="wordmark" href="#/home">
          <span className="brand-mark">N</span>NALVIS
        </a>
        <span>EDGEWISE × PROOFTRADE · HASHKEY CHAIN</span>
        <a href="?demo=1#/verify">Built to be verified ↗</a>
      </footer>
    </div>
  );
}
