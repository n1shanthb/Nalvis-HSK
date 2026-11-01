# Always-on testnet agent (human deployment only)

Nishanth deploys this after all task PRs merge. Codex deploys nothing and sends
no transactions to 133 or 177. Mainnet 177 supplies real read-only evidence;
execution uses the independent testnet sandbox pool. Testnet prices are not real.
No proven edge. Complete [testnet bootstrap](../../scripts/testnet-bootstrap.md)
first: registry entries, verified deployment manifest, policy and Ledger mandate.

## Railway

1. Create a Railway project → Deploy from GitHub repo → select `n1shanthb/Nalvis-HSK`
   and the reviewed merged branch. Keep service root `/` (the workspace root).
   Railway reads root `railway.json`, builds `deploy/agent/Dockerfile`, and uses
   the configured Node start command. Do not set root to `packages/keeper`.
2. Attach a Railway **Volume** mounted at `/data`. Set `AGENT_DATA_DIR=/data`.
   Store root defaults to `/data/agent`; optional `KEEPER_STATE_DIR` must be a
   directory inside that volume. The journal, watches, pending guard, receipt
   JSON, prompts, evidence, state snapshots and policy archives all live there.
   Keep one replica and one writer. Back up the full volume, not only receipts.
3. Set these names in Railway's **Variables UI only**, never GitHub, a Docker
   build argument, frontend variables, command lines in docs, or a committed file:

   | Variable | Setting |
   | --- | --- |
   | `AGENT_OPENROUTER_API_KEY` | dedicated server-only agent provider credential |
   | `STRATEGIST_MODEL` | `anthropic/claude-haiku-5.5` |
   | `FITTER_MODEL` | `xiaomi/mimo-v2.6-flash` |
   | `AGENT_DAILY_LLM_BUDGET_USD` | `1.00` |
   | `AGENT_MAX_WAKES_PER_HOUR` | `12` |
   | `AGENT_PRIVATE_KEY` | distinct testnet agent key, gas only |
   | `HSK_MAINNET_RPC` | documented mainnet RPC, read-only |
   | `HSK_TESTNET_RPC` | documented testnet RPC, must report 133 |
   | `VAULT_ADDRESS` | verified vault from deployment manifest |
   | `AGENT_POLICY_FILE` | `/app/policy/agent-v3.json` |
   | `AGENT_FEED_CORS_ORIGIN` | exact Vercel HTTPS origin, no trailing slash |
   | `AGENT_POLL_SEC` | `30` (polite public API polling) |

   `AGENT_FEED_ORIGINS` is a comma-separated allowlist alias and takes precedence
   over the single `AGENT_FEED_CORS_ORIGIN`. The T12 provider's dedicated
   `AGENT_OPENROUTER_API_KEY` is required for this service. The desk's
   `OPENROUTER_API_KEY` is never used by the agent. The
   provider already requires JSON-capable routes (`require_parameters: true`)
   and low reasoning. Do not change models/prompts without regenerating policy
   and having the owner sign the new hash.
4. Railway injects `PORT`; the service binds `0.0.0.0:$PORT`. Without `PORT`,
   `AGENT_FEED_PORT` defaults to 8787. Configure healthcheck `/healthz`.
   Health means the feed process is alive; inspect `/feed/state` for ONLINE,
   OFFLINE, NEEDS_OWNER or budget pause. `/healthz` includes a bounded preflight
   reason and whether ephemeral mode was explicitly enabled. Missing key/model,
   wrong policy, paused/expired mandate or unavailable storage keeps execution
   offline while leaving the feed available. Never enable `AGENT_ALLOW_EPHEMERAL`
   in Railway. A writable non-root, non-tmpfs/overlay volume mount is required.
5. Settings → Networking → Generate Domain. Use its HTTPS URL as
   `VITE_AGENT_FEED_URL` in Vercel and rebuild the dashboard. Set Railway's exact
   CORS origin to that site's origin; test a permitted and a rejected Origin.
   No feed endpoints accept writes. Requests are capped at 10 rps per socket IP;
   forwarded IP headers are deliberately untrusted. Railway proxy peers may share
   that cap. If traffic requires trusted-proxy support, configure it explicitly
   in a reviewed follow-up; do not trust arbitrary forwarded headers.
6. Confirm preflight, a first wake/WAIT anchor and `pnpm verify` on the receipt.
   Run `scripts/agent-preflight.sh` locally against the HTTPS domain. Keep the
   service logs free of env values. Railway retains/rotates platform logs;
   configure its retention for your plan (plan-specific retention is UNVERIFIED).
   The hash-chained journal is audit data: never truncate it as log rotation.
7. Stop the service in Railway to send SIGTERM. The process stops polling, lets
   the current wake finish (including mining wait), flushes atomic files and
   releases its lock. Allow at least 300 seconds for shutdown. Owner **Pause** on
   the Ledger immediately prevents trading; the agent observes it on its next
   poll and shows NEEDS_OWNER. Revoke permanently removes the mandate agent.

## Linux or laptop fallback

Install Node 22/pnpm 9 and build with `pnpm install --frozen-lockfile` and
`pnpm --filter @nalvis/keeper build`. Place the reviewed checkout at `/opt/nalvis`.
Create a `nalvis` user; put runtime variables in `/etc/nalvis/agent.env`, owner-only
permissions, readable by that service account. Copy `nalvis-agent.service` into
`/etc/systemd/system/`, run `systemctl daemon-reload`, then enable/start it.
Back `/var/lib/nalvis` with a dedicated persistent filesystem mount. For an
ordinary persistent laptop directory without a dedicated mount, explicitly set
`AGENT_ALLOW_EPHEMERAL=1`; health reports that override. Use a persistent directory,
back it up, and understand that the service cannot prove storage durability.

For temporary HTTPS access run:

```sh
cloudflared tunnel --url http://localhost:8787
```

Use the resulting HTTPS domain as the dashboard URL and configure the exact
browser origin allowlist. Quick tunnel availability/domain persistence is
UNVERIFIED; restart changes the URL. Run `journalctl -u nalvis-agent` for logs;
set journald `SystemMaxUse`/`MaxRetentionSec` for rotation. Stop with
`systemctl stop nalvis-agent` or SIGTERM; do not SIGKILL unless necessary.

## Recovery and freeze export

Never run two replicas against one store. The Linux advisory writer lock is released by the kernel on crash/container
death; it does not rely on reusable process IDs. Linux hosts require `flock`
(util-linux), included in the Docker base image. On restart a mined pending intent
is matched against its exact tx calldata, sender and Receipt event. A missing,
ambiguous or reverted transaction stays NEEDS_OWNER/OFFLINE and is **never resent**.
Inspect wallet latest/pending nonce and chain logs before manual recovery. Never
remove pending guards to force execution.

Stop cleanly, then run with the same data directory:

```sh
pnpm keeper export-agent --chain 133
# Copy receipts/133/agent/ from the host to the reviewed local checkout.
# Verify each receipts/<hash>.json with the complete exported artifact root:
pnpm verify receipts/133/agent/receipts/<receipt-hash>.json --rpc "$HSK_TESTNET_RPC" --agent-root receipts/133/agent
```

Export requires the exclusive writer lock and rejects pending intents or broken
journals. Commit only the reviewed `receipts/133/agent/` snapshot at freeze (use
`git add -f` because generated receipts are ignored). Never commit a volume dump,
.env, private key or provider credentials. Vite serves the snapshot as static
assets for Vercel fallback. Without an export the dashboard honestly shows no
snapshot and continues to read on-chain Receipt logs.
