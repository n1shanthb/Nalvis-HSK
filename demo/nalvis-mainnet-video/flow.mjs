const BASE = 'https://nalvis-hsk-delta.vercel.app/?demo=0';
const TX = 'https://hsk.blockscout.com/tx/0x7a3020fb769d4181f235dc40483b74fe4c7408a02a311d5e30b3c16390d5722b';

const park = async (page) => page.mouse.move(1870, 80);
const center = async (page, locator) => {
  await locator.first().evaluate((el) => el.scrollIntoView({block: 'center', behavior: 'smooth'}));
  await page.waitForTimeout(800);
};
const openWorkspace = async (page, route) => {
  await page.goto(`${BASE}#/agent`, {waitUntil: 'domcontentloaded', timeout: 45_000});
  const choice = page.getByRole('button', {name: /View Nishanth.s mainnet agent/i});
  if (await choice.isVisible().catch(() => false)) await choice.click();
  if (route !== 'agent') {
    await page.locator(`a[href$="#/${route}"]`).first().click();
  }
  await page.locator('main').waitFor({state: 'visible'});
  await page.waitForTimeout(route === 'agent' ? 8_000 : 2_500);
  console.log(`[nalvis-flow] route=${route} url=${page.url()} heading=${await page.locator('main h1, main h2').first().textContent().catch(() => 'missing')}`);
};

export default {
  title: 'Nalvis — Ledger-governed execution with verifiable receipts',
  template: 'walkthrough',
  colorScheme: 'dark',
  brand: '#b8ff3d',
  caption: {theme: 'pill', size: 'md', position: 'bottom'},
  intro: {
    title: 'NALVIS',
    subtitle: 'Ledger-governed DeFi automation on HashKey Chain',
    layout: 'split',
    script: 'Nalvis brings Ledger-governed DeFi automation to HashKey Chain. Here is the live system and its proof.',
  },
  outro: {
    title: 'NALVIS',
    subtitle: 'Bounded execution. Verifiable receipts.',
    url: 'nalvis-hsk-delta.vercel.app',
    script: 'That is Nalvis: bounded execution with a mainnet swap anyone can inspect. Explore the live app and its proof.',
  },
  scenes: [
    {
      id: 's01-agent', media: 'clip', skipNetworkIdle: true,
      prepare: (page) => openWorkspace(page, 'agent'),
      record: async (page, rec) => {
        await page.getByText('Agent connected', {exact: true}).waitFor({timeout: 20_000});
        await rec.moveTo('text=Agent connected'); await rec.pause(1800);
        await center(page, page.getByText('Strategy & execution', {exact: true})); await rec.pause(2500);
        await center(page, page.getByText('Decision activity', {exact: true})); await rec.pause(1800);
        await park(page);
      },
      script: 'This is Nishanth’s public mainnet agent. The feed shows when it last woke, its status, its latest decision, and the signals behind that decision.',
    },
    {
      id: 's02-market', media: 'clip', skipNetworkIdle: true,
      prepare: (page) => openWorkspace(page, 'evidence'),
      record: async (page, rec) => {
        await rec.moveTo('h1'); await rec.pause(5200);
        await park(page);
      },
      script: 'Market evidence separates live observations from recorded charts. Missing values stay unavailable instead of becoming invented prices.',
    },
    {
      id: 's03-mandate', media: 'clip', skipNetworkIdle: true,
      prepare: (page) => openWorkspace(page, 'mandate'),
      record: async (page, rec) => {
        await center(page, page.getByText('Mandate countdown', {exact: true})); await rec.pause(2300);
        await center(page, page.getByText('Trade & daily limits', {exact: true})); await rec.pause(2300);
        await center(page, page.getByText('Execution controls', {exact: true})); await rec.pause(1800);
        await park(page);
      },
      script: 'The signed mandate sets the agent, expiry, trade size, daily turnover and slippage limits. The owner retains pause and revoke.',
    },
    {
      id: 's04-operations', media: 'clip', skipNetworkIdle: true,
      prepare: (page) => openWorkspace(page, 'operations'),
      record: async (page, rec) => {
        await rec.moveTo('h1'); await rec.pause(1200);
        await rec.moveTo('button:has-text("Strategist")'); await rec.pause(1700);
        await rec.moveTo('button:has-text("Checks")'); await rec.pause(1700);
        await rec.moveTo('button:has-text("Receipt")'); await rec.pause(1200);
        await park(page);
      },
      script: 'The operations view maps evidence, strategy, checks, execution and receipts. Each stage shows what was actually observed.',
    },
    {
      id: 's05-activity', media: 'clip', skipNetworkIdle: true,
      prepare: (page) => openWorkspace(page, 'activity'),
      record: async (page, rec) => {
        const firstDecision = page.locator('main button, main summary').filter({hasText: /WAITDecision details/}).first();
        await center(page, firstDecision); await rec.click('main button:has-text("Decision details"), main summary:has-text("Decision details")'); await rec.pause(3800); await park(page);
      },
      script: 'Activity records decisions, including waits. Open a row to inspect its timestamp, rationale and transaction link.',
    },
    {
      id: 's06-copilot', media: 'clip', skipNetworkIdle: true,
      prepare: (page) => openWorkspace(page, 'desk'),
      record: async (page, rec) => {
        await center(page, page.getByRole('heading', {name: 'Review a WHSK buy', exact: true}));
        await rec.moveTo('input'); await rec.pause(4200); await park(page);
      },
      script: 'Copilot can prepare a buy or sell review. A request alone does not send a trade.',
    },
    {
      id: 's07-swap-proof', media: 'clip',
      prepare: async (page) => {
        await page.goto(TX, {waitUntil: 'domcontentloaded', timeout: 60_000});
        await page.getByText('Success', {exact: true}).first().waitFor({timeout: 45_000});
        await page.waitForTimeout(3_000);
      },
      record: async (page, rec) => {
        await center(page, page.getByText('Success', {exact: true}).first()); await rec.pause(2200);
        const transfers = page.getByText(/Token transfers/i).first();
        if (await transfers.isVisible().catch(() => false)) { await center(page, transfers); await rec.pause(3000); }
        const logs = page.getByText('Logs', {exact: true}).first();
        if (await logs.isVisible().catch(() => false)) { await rec.click('a:has-text("Logs"), button:has-text("Logs")'); await rec.pause(3500); }
        await park(page);
      },
      script: 'Here is the mainnet swap. One USDT left the vault and 11.391399 WHSK returned through HSKSwap. Block 29644690 includes the vault Receipt event, sequence six.',
    },
    {
      id: 's08-verifier',
      prepare: async (page) => {
        await page.goto(new URL('./verifier-proof.html', import.meta.url).href);
        await page.locator('h1').waitFor();
      },
      target: '.checks', action: 'none', zoom: 1.08,
      script: 'The independent verifier rechecks the signature, mandate, calldata, transaction and chain head against the committed proof files. All eighteen checks pass.',
    },
    {
      id: 's09-architecture',
      prepare: async (page) => {
        await page.goto(new URL('./architecture.html', import.meta.url).href);
        await page.locator('h1').waitFor();
      },
      target: '.flow', action: 'none', zoom: 1.04,
      script: 'The Ledger sets authority. The models propose. Deterministic checks and the vault constrain execution; OCI keeps the journal and live feed.',
    },
  ],
};
