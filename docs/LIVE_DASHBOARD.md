# Live dashboard demo connection

The browser uses the same-origin GET-only `/api/agent?path=/feed/...` relay. The relay permits only existing public feed routes and content-addressed artifacts, has a fixed operator-selected upstream, forwards no cookies/credentials, and never loads the keeper's environment or signing key. Mutations, arbitrary URLs, paths and cursors fail closed. Short server-side caching coalesces repeated judge reads.

Set `AGENT_FEED_UPSTREAM` in the Vercel server environment for a stable HTTPS endpoint. No key belongs in any `VITE_*` variable. `VITE_AGENT_FEED_URL` remains an optional direct-feed override; omit it to use the relay. The hosted dashboard selects mainnet 177 for reads; owner signing still requires the existing explicit build activation.

For this owner-approved demo, `apps/dashboard/server/demo-feed.ts` records the temporary Cloudflare URL. The OCI systemd unit `nalvis-feed-tunnel.service` forwards to the existing loopback-only port 8787. The keeper, its container, mandate, strategy and persistent storage are unchanged. No inbound OCI firewall port was opened.

The tunnel runs on OCI while the PC is off, but a Quick Tunnel has no uptime guarantee and its hostname changes when its process restarts. After a restart, read the new URL from `sudo journalctl -u nalvis-feed-tunnel.service`, update `AGENT_FEED_UPSTREAM` and redeploy (or update the explicit demo fallback). A named tunnel and owned domain are the permanent replacement. Disable the demo service with `sudo systemctl disable --now nalvis-feed-tunnel.service` after judging.

The Agent pulse shows observed decisions, recorded rationale, configured models, policy source rules, watch triggers and spending. Decision dots are ordered observations, not trade confirmations or prices. In-flight model phases and private chain-of-thought are not present in the public feed. WAIT decisions need not create an on-chain transaction on every wake; Activity distinguishes observations from transaction receipts.

Validation: dashboard tests cover relay route/method restrictions, credentials isolation, request coalescing, unavailable upstreams, schedule-aware freshness and honest decision labels. Check `/api/agent?path=/feed/state` returns chain 177, then check Agent and Overview show the same last wake and decisions. Verify browser widths 375/768/1024/1440 without page overflow. Never broadcast a transaction as part of dashboard verification.
