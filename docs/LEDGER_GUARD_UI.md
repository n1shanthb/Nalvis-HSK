# Ledger Guard UI adaptation

This supersedes the ivory/forest visual direction in UI_REDESIGN.md. Approved reference: https://ledger-gaurd.vercel.app/ and the owner's https://github.com/n1shanthb/Ledger-gaurd repository. Implemented on feat/ledger-guard-ui, starting from the earlier operator UI branch. No Figma or Pingfusi calls were used for this implementation.

## Presentation

The UI uses the reference's Syne display font, DM Sans body, JetBrains Mono labels, #05070A background, #EEF2E6 text, #8A9388 secondary text, #1C242C dividers, #0A0E12/#10161C surfaces, #A3E635 signal and #5EEAD4 comparison colour. Font files are self-hosted with their licenses.

The desktop shell is a centred 1152px layout with sticky horizontal navigation and open, divided sections. Mobile uses a modal navigation menu. The landing follows the reference's oversized heading, restrained background wash, numbered workflow, pillars, proof links and footer. Nalvis's actual claims replace Ledger Guard's Base/Pyth/Graph/payment claims.

## Page map

- / or #/home: public explanation and recorded proof links.
- #/overview: readiness, next action, current mandate, inventory when available, latest receipts and recorded portfolio.
- #/setup: existing mandate journey, with unchanged validation, calldata review and signing gates.
- #/mandate: authority and current/recorded limits. Setup and management now have distinct purposes.
- #/activity: decision filters and receipt inspection. Demo rows use genuine T8 Anvil recordings; live records retain the existing receipt/event binding checks.
- #/agent: role strip, operations scene, grounded desk, watches, negotiations and usage. Diagnostics are secondary disclosures.
- #/evidence: independent market page with price, basis, provenance, source quality and applicable limits. Demo history remains explicitly synthetic/recorded.
- #/verify: independent verifier. Demo transaction deep links use the matching recorded RPC reader; live requests still use the selected read-only RPC.
- #/receipts aliases Activity and preserves its query. #/desk remains a drawer shortcut. Query parameters and transaction deep links are retained when changing demo/live mode.

## Operations and charts

The lazy-loaded 3D scene uses a glass platform, gridded floor, coloured role pedestals, hardware authority, and orbit controls, adapted from the reference's visual composition. The stages are Evidence, Strategist, Fitter, deterministic Checks, Execution and Receipt; Ledger is the owner-authority boundary.

A missing feed never means running, idle, complete or confirmed. Demo role examples are labelled UI EXAMPLE and cannot trigger observed-operation highlights. Transaction references do not imply confirmation. Selecting a role inspects its state; it does not execute anything. Reduced motion, WebGL unavailability/errors and runtime context loss have a readable 2D fallback. Rendering is on demand, with DPR capped at 1.5; scene dependencies load only with the operations view. The 3D chunk remains relatively large (approximately 264 kB gzip).

Charts retain the existing observations, gaps, rule thresholds and event binding. They use lime primary series, cyan comparisons, subtle area fills, faint grids, monospace axes and approximately 280px plot height. Accessible summaries and alternative data tables remain available. Portfolio-weight bounds are not drawn on a price axis.

## Validation

- Dashboard validation: 162 passing suite tests plus one focused market-page regression (163 total), including owner gates, proposal lifecycle, chart data, receipt binding, route aliases, demo provenance, offline Activity-to-verifier replay, reduced-motion fallback, operations state semantics, and preserved transaction overlays/token units on the separate market page.
- Workspace builds and lint passed after the implementation. Existing chunk-splitting warnings remain; the 3D view is lazy-loaded.
- Full workspace tests reproduce the pre-existing Windows core failure in test/agent/agent.test.ts: Store path escapes root, from src/agent/store.ts. No backend fix was included.
- All eight principal views were checked at 375, 768, 1024 and 1440px. All 32 recorded width checks show no page-level horizontal overflow. Evidence: ledger-ui-review/responsive-checks.json and matching page screenshots.
- Recorded TRADE -> Activity details -> Verify returns PASS using the recorded T8 RPC responses. Invalid/live verifier behaviour remains covered by the existing suite.
- Mobile menu Escape/focus return and the recorded mandate comparison table were checked locally without signing. Real Ledger signing and broadcasts were not performed.
- Real live agent status is still unavailable: the existing feed hook exposes explicit demo fixtures only. No new feed endpoint, polling service or model integration was invented.
- Contracts, core/keeper/verifier packages, signing code, receipt schemas, trading rules, credentials and chain restrictions were not modified. Foundry is unavailable here; contracts were not edited.

Screenshots in ledger-ui-review are local development evidence, not deployment or independent reviewer approval. Earlier ui-review screenshots remain historical evidence of the superseded design.
