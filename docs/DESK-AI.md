# Dashboard language providers

The landing page uses an ember/black palette; the console uses deep teal and lime. Overview metrics and charts come from the committed T8 recordings, not invented market data. Use `/?demo=1#/mandate` for the recorded console, or `/` for the landing page.

## Configure later

Everything works without AI credentials. The desk defaults to **Built-in commands**. Groq and OpenRouter are independently selectable only when the server reports them configured. No paid automatic provider switching occurs.

Add these **server** environment variables to the existing Vercel project, then redeploy:

- `GROQ_API_KEY` and `GROQ_MODEL`
- Optionally `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`
- `DESK_AI_ENABLED=false` disables both providers.

Choose a model available to your account that supports JSON object responses. See [Groq models](https://console.groq.com/docs/models), [Groq chat API](https://console.groq.com/docs/api-reference) and [OpenRouter chat API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion). No model identifier is silently chosen for you. Never prefix secrets with `VITE_`, put them in the browser, or commit them. For local development, use the root ignored `.env.local` and restart Vite. Static preview alone does not run server functions; use `pnpm dev` locally or Vercel hosting.

## Boundaries and audit

`/api/desk` forwards only the user's text and the supported-command instructions to the selected provider. It never sends receipts, keys, wallet state or portfolio context. The server selects a fixed official endpoint and configured model, validates strict JSON, rejects tool calls and unsupported commands, and returns the normalized command plus SHA-256 prompt/output hashes. The dashboard uses its existing deterministic desk with verified context for the answer and proposal. Transcript hashes appear in the conversation; desk conversations are not keeper decision receipts and do not create on-chain receipts. Existing keeper receipt transcript handling is unchanged.

Users can inspect the interpreted command. Any proposed owner action still requires the exact existing Ledger review, baseline and calldata-hash checks. AI cannot execute a trade, choose a market price, set a recipient, or change an engine verdict. Invalid output and provider errors fall back visibly to the original text and built-in commands. No provider response narrative is shown as market evidence.

Requests are limited to 500 characters, 4 KB bodies, 256 completion tokens and a 12-second provider timeout. Same-origin browser requests are required. A bounded, per-instance in-memory limiter allows 15 requests per minute per forwarded client IP. This is a best-effort public-demo limit, not global authentication; configure provider spending limits and Vercel firewall controls for a public production service. Keys and upstream error bodies are never returned or logged.

Tests use mocked provider responses; **live provider execution remains UNVERIFIED until credentials are configured**.

## Design previews

![Landing page](screenshots/ember-landing.png)
![Console overview](screenshots/teal-overview.png)
![Desk](screenshots/teal-desk.png)
![Mobile overview](screenshots/teal-mobile.png)
