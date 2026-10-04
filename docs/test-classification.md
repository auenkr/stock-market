# Test classification and CI/CD suitability

Every automated test in the repo, classified by what it exercises and whether it belongs in the PR CI pipeline. Rule: **only tests that run fully against loopback fixtures and disposable databases/caches run in CI.** Anything requiring a real external system (Polar/Stripe charges, live deployed API, real Google OAuth, Screener cookies, paid network calls, Wrangler sockets) is opt-in and never runs in CI.

## Runs in CI

| Suite | Command / location | Classification |
| --- | --- | --- |
| Generated docs drift | `pnpm docs:check` | Static consistency check |
| Typechecks | `pnpm typecheck`, `tsc -p apps/api/tests/tsconfig.json --noEmit` | Static |
| API unit tests | `apps/api/src/*.test.ts` via `pnpm test:api` | Unit: compatibility API, endpoint journeys/tiers, documentation visibility, cache logic, runtime regressions, source expansion, plan access, account access (local fixture) |
| Auth/db unit tests | `pnpm test:auth` (`packages/db/src/id.test.ts`, `packages/auth/src/*.test.ts`, `apps/web/src/lib/profile.test.ts`) | Unit |
| Key expiration | `pnpm test:keys` | Unit |
| API integration | `apps/api/tests/integration/{api,plugin}.test.ts`, `apps/api/src/account-access.test.ts` via `pnpm test:integration` | Disposable PostgreSQL, deterministic HTML/JSON fixtures |
| CLI integration | `apps/legerline-cli/tests/e2e.test.ts` via `pnpm test:integration` | Loopback fixture API |
| Billing authorization/webhooks | `packages/auth/tests/billing.integration.test.ts` (non-webhook-lifecycle tests) | Local Polar boundary fixtures |
| MCP OAuth integration | `packages/auth/tests/mcp-oauth.integration.test.ts` | Loopback |
| MCP protocol | `apps/mcp/tests/mcp.test.ts` | Loopback mock API |
| Browser E2E (dev) | `pnpm test:e2e` — `apps/web/tests/browser/{theme,api-explorer,mcp,mcp-oauth,billing}.spec.ts` | Disposable DB + dev server in tmux; billing uses fake Polar sandbox IDs, never real charges |
| Production browser checks | `apps/web/tests/browser/{theme,api-explorer}.spec.ts` with `ENVIRONMENT=production` | Local production build |
| Performance smoke/quota | `pnpm test:performance`, `SCENARIO=quota` | k6 against disposable local app |

## Excluded from CI (opt-in / manual only)

| Suite | Location | Why excluded | How disabled |
| --- | --- | --- | --- |
| Simulated payment integration | `packages/auth/tests/payment.integration.test.ts` | Exercises the purchase flow; founder decision keeps purchases opt-in (2026-10-03) | Omitted in `apps/api/tests/run.mjs` when `TEST_MODE=CICD` |
| Simulated payment browser | `apps/web/tests/browser/payment.spec.ts` | Same purchase-flow policy | `testIgnore` in `apps/web/playwright.config.ts` when `TEST_MODE=CICD` |
| Webhook lifecycle (integration + browser) | `packages/auth/tests/billing.integration.test.ts`, `apps/web/tests/browser/billing.spec.ts` | Real webhook delivery lifecycle kept manual per policy | `{ skip: TEST_MODE === "CICD" }` / `test.skip(...)` |
| Live sandbox payments | `apps/web/tests/payments-live/payment.spec.ts`, `pnpm test:payments:live` | Real Polar sandbox charges, real webhook tunnel, seeded account | Separate opt-in command; never in `ci.yml` |
| Live quota regression | `apps/api/src/account-access.test.ts` with `ACCOUNT_TEST_API_URL` | Hits the deployed API | `ACCOUNT_TEST_API_URL` unset in CI; CICD skip added |
| MCP dev-stack E2E | `apps/mcp/tests/e2e.test.ts` (live mode) | Needs a running dev web/API stack | CICD skip added; fixture mode still allowed |
| Service-backed cache/Valkey checks | Integration + MCP E2E cache paths | No Redis/Valkey service and `CACHE_ENABLED=false` in CI | `TEST_MODE=CICD` → no Valkey service, cache checks skipped |
| Load/stress/spike/soak | `SCENARIO=load\|stress\|spike\|soak pnpm test:performance` | Capacity experiments, too slow for PR CI | Long scenarios are opt-in invocations |
| Live source smoke / Screener cookie checks | `apps/api/scripts/smoke-cache.mjs`, cookie-backed smoke | Requires real Screener session | Not wired into CI |

Mode switch: `TEST_MODE=CICD` (set by GitHub Actions and forced by `pnpm test:ci`) selects the CI column above; `TEST_MODE=LOCAL`/unset includes the disposable cache checks but still not live payments. See [ci.md](ci.md#decision-payment-checks-are-opt-in-2026-10-03).
