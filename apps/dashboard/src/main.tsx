import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>Nalvis-HSK</h1>
      <p>Scaffold only. Mainnet is read-only.</p>
      <p>Testnet: prices are not real. No proven edge.</p>
      <p>Ledger signing on chain 133 requires blind signing.</p>
    </main>
  </StrictMode>,
);
