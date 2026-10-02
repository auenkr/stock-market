# API integration and performance tests

The tests exercise the existing API without changing routes, query parameters, authentication or response envelopes.

## Requirements and isolation

Run `pnpm install`. Integration tests require a PostgreSQL server installation (`initdb`, `postgres`, `pg_ctl`) or a running Docker daemon. Performance tests also require `k6` on PATH. On macOS, `brew install postgresql@17 k6` provides these tools; the runner discovers Homebrew PostgreSQL 17 automatically. Set `POSTGRES_BIN=/path/to/postgres/bin` for another installation. PostgreSQL initialization must run as a non-root user; use Docker or `TEST_DATABASE_URL` in root-based CI containers.

```sh
pnpm test:integration
pnpm exec tsc -p apps/api/tests/tsconfig.json --noEmit
pnpm test:performance                       # k6 smoke, all eight journey routes
SCENARIO=quota pnpm test:performance         # shared account limit
SCENARIO=load DURATION=30s RATE=5 pnpm test:performance
SCENARIO=stress pnpm test:performance
SCENARIO=spike pnpm test:performance
SCENARIO=soak DURATION=30m VUS=5 pnpm test:performance
```

The runner creates a temporary PostgreSQL cluster (or container) on a free loopback port, then creates a uniquely named `stock_test_*` database and applies the actual application schema with Drizzle. It builds the shared packages, starts local source-fixture and API HTTP servers on free ports, seeds profile-complete users, hashed keys and a usage policy, and runs the selected suite. Teardown closes HTTP connections and database clients, drops the database, stops the owned cluster/container and removes its temporary directory, including after test failures. Ctrl-C and SIGTERM are forwarded to the test process so the outer runner can clean up; SIGKILL cannot run cleanup.

To use an existing **test PostgreSQL server**, set `TEST_DATABASE_URL` to an admin connection with `CREATE DATABASE` permission. The runner creates and drops a new database on that server; it does not alter the database named in the connection URL. It does not use your root `.env` connection or the dev server. No source cookie, dashboard login or existing customer key is needed.

## Integration coverage

| Flow | Assertions |
| --- | --- |
| Public access | Health, home, docs, identical OpenAPI/Swagger, request IDs and CORS preflight |
| Authentication | Missing/malformed/unknown/expired/revoked keys, incomplete profiles, Bearer keys, live revocation and unavailable account storage |
| Endpoint catalogue | Every partial, unavailable and excluded reference route; schema fields/types/nullability, `no-store`, coverage header and personal aliases |
| Legacy API | Company listing envelopes and pagination, search aliases, IPO envelopes, exact company path input, company cache reuse and every extraction type |
| Source adapters | Financial amounts in rupees, EPS, consolidated selection, enterprise batches and multi-symbol quotes |
| Validation | Missing/unknown queries, invalid pages/dates/ranges, path restrictions, unsupported extraction, batch limit and unavailable combinations |
| Upstream failures | 404, unavailable source, expired source session, explicit error codes, failures not cached |
| Concurrency | Simultaneous source misses coalesce; two keys across two HTTP API instances atomically share 10/minute; another account remains independent; expired windows reset |
| Signed account service | Actual dashboard route over HTTP, HMAC signature checks, stale timestamps, oversized/malformed bodies, real key lookup, bridge rejection and quota propagation |

The suite sends requests over real loopback HTTP through Hono's production app, its normal middleware, real source provider/parsers, and PostgreSQL authorization. Source data comes from deterministic local HTML/JSON fixtures. The optional hard-coded Moneycontrol news request is replaced at the Axios network boundary to keep runs offline. IPO and market-wide feed fixtures include empty valid datasets; the existing source/parser tests provide richer fixture coverage (`pnpm test:api`).

This suite does not exercise Wrangler/workerd sockets, actual Screener availability, Google OAuth, dashboard UI journeys, or migration upgrade paths. Signed account-service tests invoke the actual route handler in an HTTP adapter rather than starting Next.js. The production default API factory is used; authorization decisions and the compatibility provider are not mocked.

## FinEdge integration

`pnpm test:integration` includes deterministic FinEdge HTTP fixtures through the production API factory and PostgreSQL authorization. It checks source credentials, personal aliases, enterprise per-symbol batches, notes/declaration/basic-financial envelope normalization, financial-unit preservation, 501 fallback routing, concurrent-request coalescing/cache reuse, plan restrictions, malformed upstream responses, and uncached failures. The fixture harness explicitly disables local FinEdge credentials unless the test configures a fixture provider.

For opt-in live subscription verification, put `FINEDGE_API_KEY` in the git-ignored root `.env`, then run:

```sh
pnpm test:integration:finedge
```

This suite calls real FinEdge endpoints through compatibility routes, checks ten newly connected datasets and four financial variants using ITC, and verifies Basic denial for TCS. It consumes up to 15 upstream calls. It exercises the real provider and compatibility router; PostgreSQL authentication is covered by the offline HTTP integration suite. No source credential is printed or stored in fixtures. The live suite is separate from routine offline tests.

## k6 workloads and results

| Scenario | Workload |
| --- | --- |
| `smoke` | One VU, eight iterations, each selecting a different API journey route |
| `load` | Constant arrival rate, default five journeys/second for two minutes; configurable `RATE`, `DURATION` |
| `stress` | Ramp from 1 to 5, 20 and 40 journeys/second, then down; maximum 100 VUs |
| `spike` | Jump from one to 50 VUs, hold, then recover |
| `soak` | Default five VUs for 30 minutes; configurable `VUS`, `DURATION` |
| `quota` | Fourteen requests split across two unused keys of one account; exactly ten 200s and four 429s, valid Retry-After and health after saturation |

Journeys rotate through warm profiles, financials, quote batches, enterprise profiles, legacy pagination/search, invalid queries and unavailable datasets. Every iteration also checks invalid-key rejection and public health. Local runs add a unique synthetic symbol to exercise cold source cache misses. `THINK_TIME` sets the pause per journey (default 0.1 seconds). Arrival-rate settings count **journeys**, with four requests per local journey, not individual HTTP requests.

The isolated capacity workloads use a 1,000,000/minute allowance; only the isolated quota workload uses the production default of 10/minute. This keeps ordinary throughput tests from measuring mostly quota rejections. No policy on the dev or deployed API is changed.

Checks require the exact expected status, request ID and route-specific response structure. Expected 400/401/501 responses do not count as HTTP failures. Unexpected 429s fail capacity checks. Quota requests accept 200/429 at the HTTP-metric level but separately enforce the exact allowed/limited counts and response bodies. Thresholds require all checks/outcomes to pass, under 1% unexpected HTTP failures, zero dropped iterations in capacity scenarios, p95 below 1500 ms and p99 below 3000 ms. Override latency budgets with `P95_MS` and `P99_MS`; these defaults are local fixture budgets, not agreed production SLOs. Threshold failures return a nonzero exit code.

JSON summaries are written to `apps/api/tests/performance/results/<scenario>.json` (git-ignored), including latency distributions, throughput, failure/check rates, throttling and threshold results. Each fresh run owns and removes its users, keys and data. Long stress/spike/soak runs are opt-in; smoke success alone does not establish sustained capacity.

For an independently provisioned test deployment, invoke the script directly:

```sh
BASE_URL=http://localhost:8787 API_KEY="$TEST_API_KEY" SYMBOL=ITC SYMBOL_2=RELIANCE SCENARIO=load \
  COLD_SOURCE=0 DURATION=30s k6 run apps/api/tests/performance/api.k6.js
```

The script defaults to ACME/DEMO fixture symbols; set `SYMBOL` and `SYMBOL_2` to a deployment's seeded test symbols. Provision sufficient allowance before a capacity run. For direct quota runs, set `QUOTA_KEY` and `QUOTA_KEY_2` to unused keys for the same account with a 10/minute allowance. Direct runs do not create or delete deployment accounts. The Node runner always targets its own disposable local app and ignores `BASE_URL`/`API_KEY` from the environment.

Scenario configuration and lifecycle follow the [Grafana k6 scenario documentation](https://grafana.com/docs/k6/latest/using-k6/scenarios/) and [test lifecycle documentation](https://grafana.com/docs/k6/latest/using-k6/test-lifecycle/).

## Web browser regressions and pre-push checks

Run `pnpm --filter @stock-market/web exec playwright install chromium` once, then `pnpm test:web`. Tests cover theme switching on `/`, `/documentation`, and `/docs`, persisted preferences, system dark mode, reduced motion, and unavailable View Transitions/storage. They also check smooth documentation anchor scrolling and that development and production builds use separate output directories, preventing missing client bundles and unresponsive controls.

The test runner starts its own loopback server on port 3105 in a temporary window of the `stock-market` tmux session. It uses `.next-theme-tests`, then closes its window and restores Next's generated TypeScript inputs. The normal dev server uses `.next-dev`; production uses `.next`. Browser artifacts are ignored by Git.

Run `pnpm hooks:install` once per checkout to enable the checked-in `.githooks/pre-push` hook. It runs `pnpm test:pre-push`: generated-doc checks, typechecks, API/auth/key tests, database integration tests, and browser tests. It blocks pushes when any check fails. The hook is installed in the current checkout; cloned checkouts must install it too. Browser tests exercise public pages without sending email or changing user accounts.

Production uses one database connection per web instance, closes idle connections after five seconds, and rotates connections after a minute. Account-service requests allow 30 seconds for queued quota checks. The live quota regression can be run with `ACCOUNT_TEST_API_URL=https://stock-market-api.auenkr.com node --env-file=.env --import tsx --test apps/api/src/account-access.test.ts`; its temporary test accounts and keys are deleted afterwards.
