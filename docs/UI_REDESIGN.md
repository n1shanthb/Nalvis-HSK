# Nalvis UI audit and implementation record

Reviewed 1 November 2026 (IST). Audience: owners and operators. Scope: dashboard presentation and interaction only. No backend, contract, signing implementation, data source, or trading-rule edits.

## Baseline and evidence

The untouched Git HEAD was served from an isolated archive on localhost:5174 for comparison; the working redesign runs on localhost:5173. Baseline screenshots were reconstructed after the first local UI edits from that untouched archive, not from the modified source. Each screenshot filename names the page and viewport width. `responsive-checks.json` records actual browser viewport and document widths.

Baseline: [landing, desktop](ui-review/before-landing-1440.png), [Agent, mobile](ui-review/before-agent-375.png), [mandate, desktop](ui-review/before-mandate-1440.png), [verification, desktop](ui-review/before-verify-1440.png).

Four widths: 375, 768, 1024, 1440. The review covered live/unavailable Agent, recorded Agent, Mandate, Verify, landing, mobile navigation, AI desk, invalid transaction input and recorded verification. Owner signing/review behaviour was exercised through existing fixtures/tests; no hardware signing or broadcasts were performed.

## Findings and corrections

1. **High — fragmented product identity.** Orange landing gradients, green console backgrounds, lime buttons and charcoal cards competed. Evidence: baseline landing and Agent screenshots. Impact: the public site and operational console felt unrelated. Replaced with one typography/spacing system and related light/dark surfaces. The initial navy proposal was rejected by the owner; the final palette is ivory, charcoal and forest green.
2. **High — readiness was below market charts.** Baseline Agent placed disconnected status after multiple charts. Impact: operators could mistake a chart-filled screen for a running agent. Moved readiness and blockers before all charts; expanded diagnostics are secondary.
3. **High — misleading chart title.** Baseline price chart said Live while displaying recorded history. Impact: historical data could be read as current. Title now follows the presence of actual live observations; source badges, timestamps, history seeds and live-divider semantics remain intact.
4. **Medium — mobile header consumed too much space.** Ledger, desk, mode switch and navigation wrapped into a tall header. Replaced desktop navigation with a 224px sidebar and a native modal navigation dialog below 1024px. Explicit close, Escape and focus return verified locally.
5. **Medium — repeated empty sections.** Feed-unavailable text repeated across watches, negotiations and costs. Kept the main readiness explanation visible and moved secondary areas into labelled disclosures. Section-specific market/deployment errors remain visible.
6. **Medium — mandate fields lacked grouping.** A long definition list mixed identity, budgets, controls and hashes. Grouped authority/expiry, trade/daily limits and execution controls; policy commitment/read block and network contracts have separate disclosures. Values and validation sources are unchanged.
7. **Medium — optional JSON dominated verification.** A large textarea appeared before the primary action. It is now a labelled optional disclosure; recorded replay has its own explanation and action surface.
8. **Medium — verification ordering was unclear.** Results appeared as a flat list. Checks now use an ordered list with explicit text that execution stops at the first failure and later checks are not run. Verifier output and stopping behaviour are unchanged.
9. **Medium — landing mandate link opened Agent.** The Inspect the signed mandate link pointed to Agent. Corrected to the existing mandate route.
10. **Medium — recorded decision copy was misleading.** The preview said Safe to do nothing while the recorded verdict was REJECT, and showed the raw cex_missing reason. It now says Execution blocked with a plain-language explanation. No decision or trace was changed.
11. **Medium — styling drift.** The old stylesheet layered global rules, hardcoded colours and repeated breakpoints. Replaced it with shared semantic tokens and grouped component rules. Retained chart alternative data, focus, owner tables, drawers and reduced-motion support.
12. **Low — system font dependency.** Inter was named but not bundled. Added the Latin variable WOFF2 with its SIL Open Font License, served locally without a font CDN.

## Infrastructure and existing limits

These are not presentation defects and were not concealed or changed:

- `useAgentFeed` currently provides fixtures only with the explicit demo query; live mode has no connected agent feed.
- No verified vault deployment is currently available to the live dashboard. Owner actions therefore cannot be hardware-tested here.
- Market services may be unavailable or blocked by CORS/network conditions. Recorded historical series remain labelled as recorded; missing live values are not replaced with zero.
- Evidence and Receipts links redirect into Agent; Desk opens as a drawer. These route behaviours are preserved. Overview, MarketChart and other unreferenced view files were not promoted into new routes.
- Existing core test failure on this Windows checkout: `test/agent/agent.test.ts`, watches restart case, `Store path escapes root` in `src/agent/store.ts`. Reproduced before UI edits; backend fix is outside this work.

## References and visual decisions

Public references were searched and visually inspected locally. Mercury Treasury (https://mercury.com/treasury) informed whitespace and the labelled product preview. Ramp (https://ramp.com) informed task/action hierarchy; its bright accent was deliberately not adopted. Safe Wallet (https://safe.global/wallet) informed review context and authority language. Their logos, balances, testimonials and adoption claims were not copied.

Figma reference file: https://www.figma.com/design/HwIYiaPdQ7h8KeQuRyKKfL

One focused reference-screen pass produced landing, operator readiness and mandate review compositions, followed by the owner's requested palette correction. No Figma audit, raster generation, shaders or motion generation was used. The Figma screenshot endpoint timed out; the application screenshots are the authoritative rendered review evidence. These are reference compositions, not a complete Figma component library.

## Final foundations

Marketing: ivory #F6F3EB, ink #232A24, secondary #5B675C, forest action #234D3B, white action label. Console: charcoal #171917, surface #202320, raised #2B302B, text #F2F1EB, secondary #B5BCB1, accent #B7CEBC. Status colours remain semantic and labelled.

Inter is self-hosted; hashes use system monospace; financial values use tabular numerals. Controls use 8px radii, panels 12px, touch controls at least 44px, and spacing in 4px increments. No decorative gradients/glows. Motion is limited to short control transitions and disabled under reduced motion.

Contrast calculations are in `ui-review/contrast-checks.json`. Checked main text/action pairs all exceed WCAG AA 4.5:1; the lowest is marketing secondary text at 5.35:1. This is not a full external accessibility certification.

## Validation and remaining manual checks

Dashboard regression suite: 154 passing tests after navigation/hierarchy coverage was added. Workspace builds and lint passed. Recorded verification returns PASS locally; malformed transaction input produces an alert. Native mobile navigation and AI desk Escape/focus return verified. Four-width checks found no page-level horizontal overflow. Inter loads from the local font asset.

Not verified: real Ledger hardware signing and data-hash display, actual testnet broadcast, live deployed-vault states, full assistive-technology testing, and native 200% browser zoom (the embedded browser did not apply the shortcut). Responsive layouts were checked directly at the widths above. Foundry is unavailable in this environment; contracts were not edited.
