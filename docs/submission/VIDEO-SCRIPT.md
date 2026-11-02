# Recording script — approximately 3 minutes 30 seconds

Record 1920×1080, browser at 100%, clear microphone. This script presents the
real current state, including WAIT. No new trade or transfer is needed.

## Preparation

- Open the production app, mainnet vault, mandate transaction and WAIT
  transaction from the README. Close unrelated tabs and disable notifications.
  Never film private keys, seed phrases, API keys, env files or the Ledger PIN.
- Check agent status and mandate expiry before recording. The observed mandate
  expires **3 November 2026, 10:29:23 IST** unless replaced. If expired, ask
  Nishanth to handle renewal; the friend should not change policy to record.
- An optional Ledger shot requires Nishanth and the actual device. Mainnet uses
  blind signing. Copilot's physical session authorization has not yet been
  demonstrated; do not claim that it has unless actually tested.
- Any local swap footage must carry **LOCAL ANVIL TEST — NOT MAINNET** throughout.

## 0:00–0:25 · Problem and promise

**Screen:** landing page; overlay “Hardware-governed DeFi automation”.

**Narration:** “This is Nalvis. Hardware-wallet holders should not have to give
an unrestricted hot-wallet key to a trading bot. Nalvis lets an owner keep their
ownership key on a Ledger, authorize a bounded mandate, and let an agent operate
within those boundaries. Trading funds sit in a smart-contract vault; the
ownership key stays on hardware.”

## 0:25–1:00 · Show the running agent

**Actions:** open `https://nalvis-hsk-delta.vercel.app/#/agent`; choose **View
Nishanth's mainnet agent**. Show chain 177, online state, wake time and rationale.

**Narration:** “This is the real mainnet workspace, inspectable without a Ledger.
The strategist monitors executable HSKSwap quotes and fresh market context.
A fitter can negotiate a compliant proposal; deterministic checks and the
contract remain authoritative. The latest decision is WAIT. The displayed
reason is that quotes do not justify execution after costs. Waiting is an
actual agent decision, not a fabricated trade or a promise of profit.”

If the visible state changes, describe that state instead. Never narrate “online”
over a stale/offline screen or WAIT over a new trade.

## 1:00–1:35 · Owner control

**Actions:** open Mandate or expand Current mandate. Show owner, separate agent,
expiry, trade/daily caps, slippage and pause state. Stay read-only. Optional
five-second insert of the actual Ledger beside the screen, without its PIN.

**Narration:** “The owner and agent use different keys. The mandate binds who
may trade, for how long, and within what size, turnover, exposure and slippage
limits. The Ledger owner retains pause, revoke and withdrawal authority.
Autonomous trades within that envelope do not require the owner at the computer
signing each order. This is the control model we target for treasury workflows;
it limits delegated authority, not every source of financial risk.”

## 1:35–2:10 · Mainnet proof

**Actions:** show the mainnet vault address and this transaction:
`https://hsk.blockscout.com/tx/0xad4ede6b975f9178cdbfa5e6a5501603c625238094d76ac894c8bacc0f36c592`.
Pause on Success, `commitHold`, destination and Receipt event. Follow the Verify
link. If artifacts/replay are unavailable, show the missing check honestly and
use the explorer as transaction proof only.

**Narration:** “Both contracts are deployed on HashKey mainnet, with source
verification recorded. This transaction successfully anchors a hold receipt.
It is not a swap. Matching evidence and journal artifacts let the verifier
check commitments, replay and transaction bindings. Explorer success and a
complete verifier PASS are different claims; we show the result actually available.”

## 2:10–2:45 · Copilot

**Actions:** return to Agent, find Nalvis Copilot, type **sell now**, press **Ask
Copilot**. Show balances and the disabled public Confirm. Do not sign anything.

**Narration:** “Copilot turns a request into an explicit review. It shows the
position and, when executable, the exact sell size, output floor and estimated
costs. This vault currently has five USDT and no WHSK, so it correctly offers
no sell and does not invent P&L. For the actual owner, one Ledger authorization
creates a fifteen-minute sell-only session. Each order still needs Confirm and
a fresh keeper recheck within the mandate, without another Ledger prompt.
Public viewers cannot trade. Owner-directed sells are recorded separately
from autonomous decisions.”

## 2:45–3:10 · Architecture and test evidence

**Screen:** README architecture diagram and deployment links. Optional clearly
labelled local Anvil test clip. Never stage a fake terminal PASS.

**Narration:** “The owner key, model and transaction signer have separate roles.
OCI persists decisions even when the owner's PC is off. Swaps and receipts
are atomic; nonces and durable intents prevent blind resubmission after a
disconnect. Local tests exercise swapping and recovery.”

## 3:10–3:30 · Close

**Screen:** large app and GitHub URLs.

**Narration:** “Nalvis brings hardware-governed control to DeFi automation on
HashKey Chain: security-conscious delegation, continuous operation and
verifiable behavior. This is an unaudited prototype with no proven trading
edge, not guaranteed asset growth. You can inspect the agent, mandate and
receipt proof today.”

## Export and submission

- Export MP4 H.264, 1080p, approximately 3:30. Test the uploaded video without login.
- Add the real video URL to DoraHacks's video field. No placeholder URL is supplied.
- Keep mainnet/testnet/local labels visible. A receipt anchor is not swap proof.
- If a real swap later succeeds, independently verify its hash, add a short
  truthful clip and update README/DoraHacks claims together.
- The script is ready for your friend; the video itself still needs recording
  and uploading by the team.
