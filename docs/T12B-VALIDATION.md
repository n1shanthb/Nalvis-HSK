# T12B validation — 1 November 2026 (IST)

Base: main `5778ad9`, including T11, T12 and T13A, merged into
`t12b-agent-service`. T13A price/basis/limit/portfolio/cost charts are retained.
No contract implementation or protected desk/LLM source was changed. Solidity
changes are limited to the read-only mandate calldata script and its unit tests.

## Results

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS: ESLint and root TypeScript check |
| `pnpm -r build` | PASS: all packages and production dashboard |
| `pnpm test` | PASS: **435 passed, 2 skipped**, no failures |
| Core | 186 passed, 1 skipped |
| Keeper | 31 passed, 1 skipped |
| Verifier | 62 passed |
| Dashboard | 156 passed, including T13A chart/UX regressions |
| `forge test` | PASS: **141 passed, 5 skipped**, including 11 invariant properties and v3 calldata tests |
| `scripts/check-rules.sh` | PASS |
| ShellCheck 0.10.0 and `bash -n` | PASS for both new scripts |
| `testnet-setup.sh --dry-run` | PASS with mocked chain-133 HTTP RPC; 64 test USDT/WHSK price, raw ceil cap 468750000000000000 WHSK units, zero sends |
| Production scan | PASS: no synthetic Agent fixture markers, agent private-key variable, or OpenRouter credential pattern in built JS; empty key values in env example |
| Docker kit | Image build and real CLI no-key health/feed smoke passed; SIGTERM stopped cleanly |

The local Anvil service e2e uses the production RPC signing/reconciliation adapter,
dynamically deployed mock vault/pool/tokens, an HTTP OpenRouter mock and a mock
read-only market chain identity. A first wake creates a watch; moving the mock
price above 2% fires it. BUY 200 is fitted to two 100-USDT legs; leg 1 mines and
leg 2 appears as a retry watch in `/feed/watches`. SIGTERM waits for the active
wake. Restart reconciles a mined pending intent without another transaction.
The exported snapshot passes both the verifier library and actual verifier CLI.
A separate subprocess SIGKILL test proves the kernel releases the writer lock,
independently of reused PIDs. CORS, 405, rate limits, denied artifact paths,
no-key OFFLINE, failed port cleanup and export guards are covered.

The dashboard tests cover validated live panels, exported-snapshot fallback,
absence of invented data without an export, browser artifact loading and eight
independent v3 check chips. Model outputs are recorded and bound, not reproduced.

## Unverified / human steps

- No deployment, Ledger signature or transaction was sent to 133/177. All test
  sends targeted loopback Anvil 31337. Faucet claims, actual funding/swaps, Ledger
  blind signing, deployed addresses and the first live anchor remain human steps.
- The two TypeScript skips and five Foundry skips are RPC-dependent cases; live
  fork configuration was absent. Local Anvil integration/parity tests ran.
- Railway hosting, its actual persistent volume filesystem, HTTPS domain, Vercel
  origin and hosted provider/model availability require Nishanth's setup. No real
  LLM/provider request was made. Nested Docker's test mount looked ephemeral and
  was correctly refused; its CLI smoke used explicit `AGENT_ALLOW_EPHEMERAL=1`,
  visible in health. Do not use that override in Railway. Without writable
  persistent storage the feed stays OFFLINE. Docker's small local disk required
  cleanup of unused build cache; no application data was removed.
- Quick-tunnel lifetime and plan-specific Railway log retention are unverified.
  Socket-peer rate limiting can share a cap behind a hosting proxy; arbitrary
  forwarded-IP headers are deliberately not trusted.
- No testnet export, public generated policy or deployment manifest is fabricated.
  Generate those from the actual execution pool and verified deployment, obtain
  the Ledger signature, and commit reviewed public artifacts/registry rows before
  Railway deployment and the freeze export. Never commit runtime credentials.
