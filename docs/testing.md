# API integration and performance tests

GitHub Actions runs the isolated test suites, browser regressions, MCP checks, k6 smoke/quota, and production builds on PRs. See [CI setup](ci.md) for the testing environment, required merge checks, and optional external-service secrets.

**Test mode:** `TEST_MODE=CICD` is the single switch used by GitHub Actions and `pnpm test:ci`. It excludes purchase/payment suites, the existing webhook lifecycle checks, and service-backed Redis/Valkey checks. The API/MCP fixtures still run with caching disabled. `TEST_MODE=LOCAL` (also the default when unset) includes the simulated payment and cache checks for manual local runs. Real sandbox purchasing remains a separate `pnpm test:payments:live` command. A green CI run does not verify payment or Valkey behavior. See [the decision and rationale](ci.md#decision-payment-checks-are-opt-in-2026-10-03).

The tests exercise the existing API without changing routes, query parameters, authentication or response envelopes.

## Requirements and isolation

Run `pnpm install`. Integration tests require a PostgreSQL server installation (`initdb`, `postgres`, `pg_ctl`) or a running Docker daemon. The optional local Valkey checks require `valkey-server`/`redis-server` on PATH or Docker for the isolated cache. Performance tests also require `k6` on PATH. On macOS, `brew install postgresql@17 k6` provides the default tools; install Redis/Valkey separately for the opt-in cache checks. The runner discovers Homebrew PostgreSQL 17 automatically. Set `POSTGRES_BIN=/path/to/postgres/bin` for another installation. PostgreSQL initialization must run as a non-root user; use Docker or `TEST_DATABASE_URL` in root-based CI containers.

```sh
pnpm test:integration
TEST_MODE=CICD pnpm test:integration        # CI coverage, no cache/payment services
TEST_MODE=LOCAL pnpm test:integration       # manual local cache/payment checks
TEST_MODE=LOCAL pnpm test:e2e               # local cached MCP/payment browser flows
pnpm exec tsc -p apps/api/tests/tsconfig.json --noEmit
pnpm test:performance                       # k6 smoke, all eight journey routes
SCENARIO=quota pnpm test:performance         # shared account limit
SCENARIO=load DURATION=30s RATE=5 pnpm test:performance
SCENARIO=stress pnpm test:performance
SCENARIO=spike pnpm test:performance
SCENARIO=soak DURATION=30m VUS=5 pnpm test:performance
```

The runner creates a temporary PostgreSQL cluster (or container) on a free loopback port, then creates a uniquely named `stock_test_*` database and applies the actual application schema with Drizzle. In `TEST_MODE=CICD`, fixtures use `CACHE_ENABLED=false`, no Redis/Valkey service is started, and the shared cache/concurrent-miss integration assertion is skipped. In local mode, any runner mode starts a non-persistent Redis/Valkey process (or Valkey container) on a free loopback port. Each fixture then uses a unique cache prefix and the production Redis SDK. Pure cache logic unit tests use a fake store and do not connect to Valkey. It builds the shared packages, starts local source-fixture and API HTTP servers on free ports, seeds profile-complete users, hashed keys and a usage policy, and runs the selected suite. Teardown closes HTTP connections and database clients, drops the database, stops any owned cache and cluster/container and removes its temporary directory, including after test failures. Ctrl-C and SIGTERM are forwarded to the test process so the outer runner can clean up; SIGKILL cannot run cleanup. No development/production Valkey URL or existing cache entries are used.

To use an existing **test PostgreSQL server**, set `TEST_DATABASE_URL` to an admin connection with `CREATE DATABASE` permission. The runner creates and drops a new database on that server; it does not alter the database named in the connection URL. It does not use your root `.env` connection or the dev server. No source cookie, dashboard login or existing customer key is needed.

## Integration coverage

| Flow | Assertions |
| --- | --- |
| Public access | Health, home, docs, identical OpenAPI/Swagger, request IDs and CORS preflight |
| Authentication | Missing/malformed/unknown/expired/revoked keys, incomplete profiles, Bearer keys, live revocation and unavailable account storage |
| Endpoint catalogue | Every partial, unavailable and excluded reference route; schema fields/types/nullability, `no-store`, coverage header and personal aliases |
| Legacy API | Company listing envelopes and pagination, search aliases, IPO envelopes, exact company path input, company cache reuse and every extraction type |
| Source adapters | URL-valued search identifiers, financial amounts in rupees, EPS/EBIT/EBITDA, URL-based consolidated selection, basic-finance summary/price/analysis, grouped documents, and peer comparison metrics |
| Validation | Missing/unknown queries, invalid pages/dates/ranges, safe company paths, Finance symbol-only parameters, unsupported extraction, and unavailable Internal datasets |
| Upstream failures | 404, unavailable source, expired source session, explicit error codes, failures not cached |
| Concurrency | Simultaneous source misses coalesce; two keys across two HTTP API instances atomically share 10/minute; another account remains independent; expired windows reset |
| Signed account service | Actual dashboard route over HTTP, HMAC signature checks, stale timestamps, oversized/malformed bodies, real key lookup, bridge rejection and quota propagation |
| Polar billing | Real Better Auth plugin checkout/portal, authenticated owner binding, supported monthly slugs, no client-controlled product/redirect/trial, and existing-subscription rejection |
| Subscription lifecycle | Verified webhook signatures, malformed/unsigned/stale deliveries, duplicate/out-of-order events, upgrades, cancellation, past-due/revocation, automatic expiry, and 10/60/300/500 shared quotas |
| Payment integration (local mode) | With `TEST_MODE=LOCAL`: loopback Polar/Stripe substitute with real auth, checkout, signature verification, and quota storage for all three paid plans: declined cards grant nothing, `4242 4242 4242 4242` retry activates only after verified payment webhooks, renewal extends expiry, failed renewal falls back to Hobby, recovery reactivates, refunds alone cannot revoke, revocation returns to Hobby, and duplicate deliveries are safe |
| Payment browser (E2E, local mode) | With `TEST_MODE=LOCAL`: real browser against the loopback checkout form for Basic, Personal and Professional: correct new INR prices, declined card, `4242 4242 4242 4242` retry, activation, renewal failure/recovery, and revocation |
| Live sandbox payments | Opt-in `pnpm test:payments:live` against the running dev app and Polar sandbox: real checkout for all three paid plans with `4242 4242 4242 4242` (manual entry or saved-card reuse), paid-order receipt, webhook-driven activation, updated key allowance, then CLI revocation and Hobby fallback. Requires the dev account to have no pre-existing subscription; setup preserves existing subscriptions. See [Polar setup](polar-setup.md). |
| Signup consent | Required explicit acceptance, signed short-lived cookies, origin checks, server-recorded versions, and OAuth creation denied without consent |

The suite sends requests over real loopback HTTP through Hono's production app, its normal middleware, real source provider/parsers, and PostgreSQL authorization. Source data comes from deterministic local HTML/JSON fixtures. The optional hard-coded Moneycontrol news request is replaced at the Axios network boundary to keep runs offline. IPO and market-wide feed fixtures include empty valid datasets; the existing source/parser tests provide richer fixture coverage (`pnpm test:api`).

This suite does not exercise Wrangler/workerd sockets, actual Screener availability, or external Google/Polar services. Billing migration tests upgrade a representative legacy schema and verify repeatability. Signed account-service tests invoke the actual route handler in an HTTP adapter rather than starting Next.js. The production default API factory is used; authorization decisions and the compatibility provider are not mocked. Billing fixtures replace only Polar's remote HTTP service. `pnpm test:auth` exercises the real OAuth callback flow with Google token/profile calls isolated.

## k6 workloads and results

| Scenario | Workload |
| --- | --- |
| `smoke` | One VU, eight iterations, each selecting a different API journey route |
| `load` | Constant arrival rate, default five journeys/second for two minutes; configurable `RATE`, `DURATION` |
| `stress` | Ramp from 1 to 5, 20 and 40 journeys/second, then down; maximum 100 VUs |
| `spike` | Jump from one to 50 VUs, hold, then recover |
| `soak` | Default five VUs for 30 minutes; configurable `VUS`, `DURATION` |
| `quota` | Fourteen requests split across two unused keys of one account; exactly ten 200s and four 429s, valid Retry-After and health after saturation |

Journeys rotate through warm profiles, profit and loss, basic finance, a second company profile, Internal pagination, company search, invalid queries and unavailable Internal datasets. Every iteration also checks invalid-key rejection and public health. Local runs add a unique synthetic company path to exercise cold source cache misses. `THINK_TIME` sets the pause per journey (default 0.1 seconds). Arrival-rate settings count **journeys**, with four requests per local journey, not individual HTTP requests.

The isolated capacity workloads use a 1,000,000/minute allowance; only the isolated quota workload uses the production default of 10/minute. This keeps ordinary throughput tests from measuring mostly quota rejections. No policy on the dev or deployed API is changed.

Checks require the exact expected status, request ID and route-specific response structure. Expected 400/401/404 responses do not count as HTTP failures. Unexpected 429s fail capacity checks. Quota requests accept 200/429 at the HTTP-metric level but separately enforce the exact allowed/limited counts and response bodies. Thresholds require all checks/outcomes to pass, under 1% unexpected HTTP failures, zero dropped iterations in capacity scenarios, p95 below 1500 ms and p99 below 3000 ms. Override latency budgets with `P95_MS` and `P99_MS`; these defaults are local fixture budgets, not agreed production SLOs. Threshold failures return a nonzero exit code.

JSON summaries are written to `apps/api/tests/performance/results/<scenario>.json` (git-ignored), including latency distributions, throughput, failure/check rates, throttling and threshold results. Each fresh run owns and removes its users, keys and data. Long stress/spike/soak runs are opt-in; smoke success alone does not establish sustained capacity.

For an independently provisioned test deployment, invoke the script directly:

```sh
BASE_URL=http://localhost:8787 API_KEY="$TEST_API_KEY" SYMBOL=/company/ITC/ SYMBOL_2=/company/RELIANCE/ SCENARIO=load \
  COLD_SOURCE=0 DURATION=30s k6 run apps/api/tests/performance/api.k6.js
```

The script defaults to `/company/ACME/` and `/company/DEMO/` fixture paths; set `SYMBOL` and `SYMBOL_2` to a deployment's seeded company paths. Provision sufficient allowance before a capacity run. For direct quota runs, set `QUOTA_KEY` and `QUOTA_KEY_2` to unused keys for the same account with a 10/minute allowance. Direct runs do not create or delete deployment accounts. The Node runner always targets its own disposable local app and ignores `BASE_URL`/`API_KEY` from the environment.

Scenario configuration and lifecycle follow the [Grafana k6 scenario documentation](https://grafana.com/docs/k6/latest/using-k6/scenarios/) and [test lifecycle documentation](https://grafana.com/docs/k6/latest/using-k6/test-lifecycle/).

## Web browser regressions and CI checks

Run `pnpm --filter @stock-market/web exec playwright install chromium` once, then `pnpm test:web`. Tests cover theme switching on `/`, `/documentation`, and `/docs`, persisted preferences, system dark mode, reduced motion, and unavailable View Transitions/storage. They also check smooth documentation anchor scrolling and that development and production builds use separate output directories, preventing missing client bundles and unresponsive controls.

API explorer regressions check the environment-appropriate categories, eight symbol-only Finance forms, grouped documents, removed endpoints, per-endpoint request/response restoration without extra network calls, explicit resend, cached non-success statuses, and requests completing while another endpoint is open. API contract tests ensure Internal operations and unused schemas are hidden unless `ENVIRONMENT=dev`, without changing route authorization. Run the explorer tests with both `ENVIRONMENT=dev` and `ENVIRONMENT=production` to verify the web viewer and downloadable contract. Legacy regression tests verify URL-valued symbols across listings, IPOs, company-data/extraction and safe path validation. Corporate-action tests verify optional filters, all-action defaults, consolidated/ID path matching and rights pagination.

Run **`pnpm test:e2e`** for the complete billing/signup browser suite. It creates a disposable PostgreSQL database, seeds an isolated development user, configures fake sandbox IDs and webhook credentials, and runs Next.js in tmux. It verifies mobile pricing/legal navigation, signup consent before a real Google authorization-start request, persisted policy acceptance, console billing state, API key creation, verified Polar webhook upgrades/downgrades, and the actual signed account-service endpoint. A forged checkout-success query never grants paid access. External OAuth completion and actual payment charges require the [Polar sandbox setup](polar-setup.md).

The test runner starts its own loopback server on port 3105 in a temporary window of the `stock-market` tmux session. It uses `.next-theme-tests`, then closes its window and restores Next's generated TypeScript inputs. The normal dev server uses `.next-dev`; production uses `.next`. Browser artifacts are ignored by Git.

Run `pnpm test:ci` for generated-doc checks, typechecks, API/auth/key tests, database integration tests, and the disposable-database E2E browser suite. GitHub Actions runs this command plus MCP protocol tests, production browser checks, and k6 smoke/quota workloads. Git pushes do not run a hook. Browser billing tests change only isolated test accounts and do not make external payments or send email.

Production uses one database connection per web instance, closes idle connections after five seconds, and rotates connections after a minute. Signed account-service checks use request-scoped connections that close in `finally`, since suspended Vercel instances can delay idle timers. Initial key reads retry temporary connection exhaustion before spending quota; writes are never retried. Account-service requests allow 30 seconds for queued quota checks. The live quota regression can be run with `ACCOUNT_TEST_API_URL=https://stock-market-api.auenkr.com node --env-file=.env --import tsx --test apps/api/src/account-access.test.ts`; its temporary test accounts and keys are deleted afterwards.
