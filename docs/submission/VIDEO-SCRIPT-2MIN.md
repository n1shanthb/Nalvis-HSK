# Nalvis two-minute mainnet demo — script for approval

Target: exactly 120 seconds, 1920×1080, 30 fps, narrated with local Piper,
captured from the public production app and Blockscout. This script has not
been recorded yet. All app interaction is read-only. Do not connect a Ledger,
set a mandate, authorize a session, confirm a trade or submit a transaction.

| Time | Scene and screen | Narration |
| --- | --- | --- |
| 0:00–0:08 | Intro title card over a real app frame. | “Nalvis brings Ledger-governed DeFi automation to HashKey Chain. Here is the live system and its proof.” |
| 0:08–0:24 | Open the public mainnet Agent workspace; hold on online state, last wake and decision signals. | “This is Nishanth’s public mainnet agent. The feed shows when it last woke, its status, its latest decision, and the signals behind that decision.” |
| 0:24–0:33 | Market page; show source labels and a chart marked recorded. | “Market evidence separates live observations from recorded charts. Missing values stay unavailable instead of becoming invented prices.” |
| 0:33–0:43 | Mandate page, read-only; frame agent address, limits and expiry. | “The signed mandate sets the agent, expiry, trade size, daily turnover and slippage limits. The owner retains pause and revoke.” |
| 0:43–0:51 | Operations 3D, with stage labels legible. | “The operations view maps evidence, strategy, checks, execution and receipts. Each stage shows what was actually observed.” |
| 0:51–1:01 | Activity timeline; open a WAIT row and show timestamp and rationale. | “Activity records decisions, including waits. Open a row to inspect its timestamp, rationale and transaction link.” |
| 1:01–1:10 | Copilot page; show the direct BUY review form without submitting it. | “Copilot can prepare a buy or sell review. A request alone does not send a trade.” |
| 1:10–1:29 | Blockscout transaction `0x7a3020fb769d4181f235dc40483b74fe4c7408a02a311d5e30b3c16390d5722b`; show Success, 1 USDT input, WHSK transfer and vault Receipt event. | “Here is the mainnet swap. One USDT left the vault and 11.391399 WHSK returned through HSKSwap. Block 29644690 includes the vault Receipt event, sequence six.” |
| 1:29–1:41 | Real terminal verifier run against the committed receipt, evidence and journal; hold on PASS rows. | “The independent verifier rechecks the signature, mandate, calldata, transaction and chain head against the committed proof files. All eighteen checks pass.” |
| 1:41–1:52 | Clearly labelled HTML architecture graphic: Ledger → mandate/vault; market → Strategist → Fitter → deterministic checks → agent signer → vault/HSKSwap → receipt/journal/verifier. | “The Ledger sets authority. The models propose. Deterministic checks and the vault constrain execution; OCI keeps the journal and live feed.” |
| 1:52–2:00 | Outro card with live app, GitHub and swap transaction URLs. | “That is Nalvis: bounded execution with a mainnet swap anyone can inspect. Explore the live app and its proof.” |

## Capture constraints

- Use the production app at `https://nalvis-hsk-delta.vercel.app/?demo=0` and
  explicitly choose “View Nishanth’s mainnet agent.” Avoid Ledger connection
  and mandate setup actions. The Mandate page may be viewed without signing.
- Wait for the Agent feed to show “Agent connected” before filming. On Market,
  retain the recorded/live labels and show unavailable fields honestly.
- The Operations view contains “Not observed” states; do not narrate those as
  completed stages. The Activity WAIT row is a decision record, not swap proof.
- Blockscout and the terminal verifier supply the swap proof. Use the real
  committed files in `receipts/177/agent/`; do not stage a fake PASS frame.
- No wallet address or receipt hash needs redaction because these are public
  on-chain data. Blur any incidental email, token, key, or account data that
  appears during capture. Inspect each rendered scene midpoint.
- Produce one 1080p H.264/AAC MP4 with captions, narration, source flow,
  timeline, and scene review sheet. Use the existing Windows/Piper adaptations
  from `E:\agentsuite\demo\agentsuite-hackathon-source` in a new UltraDemo
  project folder.
