# Deployed API latency investigation

Investigated on 2026-10-04 against `https://stock-market-api.auenkr.com`.
Source baseline: `26a2edf`.

## Summary

There are two distinct sources of latency:

1. **A slow authorization path before data/cache access.** Production probes took
   about 4–5 seconds to reject a syntactically valid, nonexistent API key. The
   deployed architecture described in `docs/production-billing.md` calls the web
   account service; its code opens and closes a PostgreSQL connection for every
   decision, even though the Node web application already has a reusable pool.
2. **Expensive synchronous work on data-cache misses.** The legacy full-company
   loader can deliberately sleep for 18 seconds across 15 sequential schedule
   requests, before counting network latency, retries, or optional news. Even
   `/v1/extract?type=ratios` loads the full company before selecting its result.

This PR implements two compatible improvements for the authorization bottleneck:
reuse the existing bounded web database pool, and support direct Worker access
through an optional, cache-disabled Hyperdrive binding. Hyperdrive is the
recommended target architecture because it also removes the web-service hop.
Authorization-stage timing helps compare the two paths. Neither implementation
caches access decisions or weakens quota/revocation checks. The probes do not establish that connection setup
accounts for all observed delay; stage timings and post-deployment measurements
are needed to quantify the benefit and decide the next optimization.

## Live evidence

Three sequential rounds, separate curl processes, no authenticated account and no
stock-source requests. Each protected probe used `/v1/company-search?q=TCS`.
The unknown key was `sm_live_` followed by 48 zeroes; all responses were 401.

| Round | `/health` (200), TTFB seconds | Missing key (401), TTFB seconds | Unknown well-formed key (401), TTFB seconds |
| --- | ---: | ---: | ---: |
| 1 | 1.237736 | 1.466431 | 4.903113 |
| 2 | 1.893182 | 1.644035 | 4.157586 |
| 3 | 1.003163 | 0.640241 | 3.997838 |

Total time was within 0.5 ms of TTFB in these samples. The median unknown-key
TTFB was 4.158 seconds versus 1.466 seconds for a missing key. These are small,
single-client diagnostic samples, not production p95/p99 statistics. DNS, TLS,
network variation and platform startup contribute to client-observed time.

Missing keys return before account-service I/O. A well-formed unknown key enters
authorization, but cannot reach the source cache or scraper after rejection.
Consequently, scraper performance cannot explain this particular measured delay.
The samples do not distinguish service startup, regional network hops, database
connection setup, query time, or connection contention within authorization.
Runtime bindings, database region and production traces were not inspected in
this investigation; the account-service topology is based on the deployment
documentation and repository code.

Reproduce at low volume:

```sh
curl -sS --max-time 40 -o /dev/null \
  -w 'status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  'https://stock-market-api.auenkr.com/health'
curl -sS --max-time 40 -o /dev/null \
  -w 'status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  'https://stock-market-api.auenkr.com/v1/company-search?q=TCS'
curl -sS --max-time 40 -o /dev/null \
  -w 'status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  -H 'X-API-Key: sm_live_000000000000000000000000000000000000000000000000' \
  'https://stock-market-api.auenkr.com/v1/company-search?q=TCS'
```

## Request path and code findings

```text
Client -> Cloudflare API Worker
       -> Hyperdrive -> PostgreSQL (when ACCOUNT_HYPERDRIVE is bound)
       OR signed account-service POST (when ACCOUNT_SERVICE_URL is configured)
          -> PostgreSQL key/plan lookup -> atomic quota write for valid keys
       -> Workers Cache API lookup (up to 60 seconds, local to the data center)
       -> Valkey lookup on edge miss (when CACHE_ENABLED and VALKEY_URL allow it)
       -> synchronous upstream scrape on miss -> cache publication -> response
```

### 1. Per-request database connection churn (implemented fix)

- `apps/api/src/server.ts`: authorization completes before source-cache creation,
  so even a data cache hit pays this cost.
- `packages/db/src/account-access.ts`: without `sharedSql`, creates
  `postgres(..., { max: 1, prepare: false, connect_timeout: 5 })`, executes the
  lookup and quota queries, then awaits `sql.end({ timeout: 1 })` in `finally`.
- `apps/web/src/app/api/internal/account-access/route.ts`: previously omitted
  `sharedSql`, paying that connection lifecycle on every API request.
- The account-service HTTP call has a 30-second timeout. PostgreSQL connection
  exhaustion (`53300`) may trigger 30 read retries with 100–300 ms sleeps,
  adding 3–9 seconds of intentional waiting, excluding connection/query time.

The route now passes the same pool used by Drizzle in `packages/db/src/index.ts`.
The pool remains bounded to one connection per module instance, with a 5-second
idle timeout and 60-second maximum lifetime; its connect timeout is explicitly
5 seconds. The shared-client path already avoids closing the pool after a
decision. Warm requests can reuse connections, and concurrent work queues on
the bounded pool rather than each request creating another connection.

This does not eliminate cold starts, reconnection after idle expiry, or the
Worker-to-web-service hop. A one-connection pool can also queue under load;
measure queueing and total database connection use before changing its size.
Cloudflare's direct-database fallback keeps request-scoped sockets, as required
by its runtime. Missing database configuration still fails closed.

### 2. Hyperdrive suitability and implementation

**The claim that Hyperdrive can reduce database-access latency is supported by
Cloudflare's documentation and this application's architecture.** Hyperdrive
performs connection setup close to the Worker and reuses origin connections near
PostgreSQL. Our direct Worker path additionally eliminates the HTTP trip to the
Next.js account service and its possible startup delay. This accelerates access
to the database; it does not make an expensive SQL plan execute faster, eliminate
uncached query round trips, or fix scraper latency. No deployed Hyperdrive A/B
benchmark has been run, so the size of the speedup is not yet verified.

Compatibility checks:

- This project already uses Postgres.js (`postgres: ^3.4.7`, above Cloudflare's
  minimum 3.4.5) and the API enables `nodejs_compat` with a recent compatibility
  date. Cloudflare supports Postgres.js, although its recommended driver is `pg`.
- The existing auth queries use scalar parameters/results and PostgreSQL's
  atomic `INSERT ... ON CONFLICT` allowance update; they can run through a
  transaction pool without session state or a process-global Worker client.
- Cloudflare explicitly warns that Postgres.js `prepare: false` can hang/fail
  with Hyperdrive. The new Hyperdrive path uses `prepare: true` and
  `fetch_types: false` to avoid unnecessary type-discovery queries. Other paths
  retain their existing prepared-statement behavior.
- Use a **dedicated cache-disabled Hyperdrive configuration** for auth. Caching
  is on by default and cached reads are not invalidated by writes. The current
  `now()` queries are documented as uncacheable anyway, but explicitly disabling
  caching guarantees fresh authorization as queries evolve.

`ACCOUNT_HYPERDRIVE` takes precedence over `ACCOUNT_SERVICE_URL` and
`DB_CONNECTION_URL`. The Worker creates a request-scoped client pointing at the
binding's `connectionString`, and closes it after the decision; Hyperdrive keeps
the origin pool warm. A database failure fails closed, with no service fallback
or quota-write retry that could spend the allowance twice after a lost response.
Malformed keys still return before database access. Without the binding, the
existing service/direct-database selection is unchanged.

#### Activation and rollback

Provision against the **same production database** used by the account service,
with credentials authorized for the existing key/plan lookups and usage writes:

```sh
pnpm --filter @stock-market/api exec wrangler hyperdrive create stock-market-account-access \
  --connection-string="$DB_CONNECTION_URL" --caching-disabled
```

Verify the origin is reachable through a supported Hyperdrive network setup and
budget its origin connections together with the web application's connections.
Confirm caching is disabled in the created configuration. Add the returned real
ID to `apps/api/wrangler.jsonc` (no credentials belong in this file):

```jsonc
"hyperdrive": [
  { "binding": "ACCOUNT_HYPERDRIVE", "id": "<created-hyperdrive-id>" }
]
```

Deploy the API, confirm `backend: "hyperdrive"` in authorization logs, and run
the validation below. Keep the service configuration available during rollout.
To roll back, remove the binding from Wrangler and redeploy: authorization then
returns to the account service. Do not enable runtime fallback on errors.

No Hyperdrive resource or production binding was created during this PR. The
origin's connectivity, credentials, actual pool behavior and improvement must be
verified during a staging/canary rollout. The committed code is opt-in, so merging
alone does not switch authorization backends.

Primary references (checked 2026-10-04):

- [How Hyperdrive works](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
- [Postgres.js compatibility and configuration](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/)
- [Query caching and fresh authorization reads](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)

### 3. Workers Cache API + Valkey (implemented)

`apps/api/src/edge-cache.ts` wraps the existing `SourceCache` interface with a
Workers Cache API first level. The middleware installs it **after authorization**
and before handlers access source data. It caches internal source responses,
parsed company snapshots and legacy company payloads, rather than authenticated
HTTP responses. Every request still validates its key, charges quota and enforces
endpoint access; outward API responses remain `Cache-Control: no-store`.

On an edge hit, no Valkey command or connection is needed (the Valkey client
connects lazily). On a miss, the existing Valkey read-through cache provides the
shared snapshot and distributed load lock, or fetches the source. Successful
results populate the edge cache through `executionCtx.waitUntil`; all Valkey
operations finish before its request-scoped client is closed. This background
work only publishes an already-loaded payload, not a long-running scrape.

Edge TTL is the minimum of 60 seconds, the requested data TTL and the source
snapshot's remaining lifetime, rounded down. Entries retain the original source
expiry for derived-cache freshness and also carry an edge expiry checked on
read. Expired, malformed and failed cache reads fall through to Valkey. Failed
source loads are never published. Cache write errors do not fail the request.

Keys include a schema version and a hash of the Valkey namespace and canonical
source key. Existing canonical keys distinguish source URLs, query parameters,
financial mode and source-cookie identity. No API key or source credential is
placed in cache URLs. Synthetic cache URLs have no public data-serving route.

Configuration:

- `CACHE_ENABLED=true`, a configured `VALKEY_URL`, and `EDGE_CACHE_ENABLED=true`
  enable both levels in Workers. Wrangler enables both flags in this PR.
- `EDGE_CACHE_ENABLED=false` bypasses only the edge, retaining Valkey.
- `CACHE_ENABLED=false` bypasses both data caches.
- Without `VALKEY_URL` or a Workers `caches.default` implementation, no edge
  wrapper is installed; Node/unit-test runtimes retain the existing behavior.
- No additional Cloudflare resource/binding is needed for the Cache API.
- `cache.edge.hit`, `cache.edge.miss`, `cache.edge.read_failed` and
  `cache.edge.write_failed` log events expose cache behavior without source keys.

Cache API storage is local to each Cloudflare data center and may be evicted.
Valkey continues to provide cross-location reuse. A manual Valkey deletion does
not purge an existing edge entry; it can remain until its bounded expiry. For an
immediate logical purge of both levels, change `VALKEY_CACHE_PREFIX` and deploy,
or disable edge caching while performing a targeted shared-cache invalidation.
Actual edge-hit ratios and production latency still require deployed measurement.

### 4. Full-company fan-out and intentional pacing (follow-up)

`packages/scraper/src/helper/getCompanyData.ts` processes sections sequentially:
four quarterly schedules, four profit/loss schedules, four balance-sheet
schedules, and three cash-flow schedules when those sections exist. Each
uncached schedule sleeps for `DELAY_BETWEEN_API_REQUEST = 1200` ms afterward
(`packages/scraper/src/utils/constant.ts`). That is **15 × 1.2 = 18 seconds** of
pacing alone when all 15 requests miss. Missing sections and cached schedules
reduce this amount.

The API's legacy `extract` handler calls `getCachedCompanyData` before selecting
one section. A request for ratios or peers therefore unnecessarily pays for the
entire cold company, including optional Moneycontrol news. The news request is
awaited even though failures are ultimately ignored.

Recommended next change: introduce section-specific loaders/cache keys for
`extract`, with contract tests proving the returned section is unchanged and
unrelated schedules/news are never fetched. For full-company requests, move
refresh work to a rate-controlled background producer and serve timestamped
snapshots under an explicit freshness policy. Preserve source pacing rather
than replacing the serial loops with unbounded `Promise.all` traffic.

### 5. Retry and lock waits amplify tail latency (follow-up)

- `packages/scraper/src/utils/source.ts` sets a 15-second timeout and invokes
  `sendReq(..., 3)`. In `sendReq.ts`, that means **four attempts**, not three.
  Four timed-out attempts plus default 1+2+4 second backoff can take about
  **67 seconds for one source call**. `Retry-After` can make individual backoffs
  up to 30 seconds. This applies to the Axios `sourceGet` path, not automatically
  every fetch-based provider.
- `packages/scraper/src/utils/cache.ts` polls contended locks for roughly
  30 seconds before `CacheBusyError`; the lease itself lasts 120 seconds. The
  deadline is checked between commands, so command time can extend the wait.
- Valkey connects lazily per Worker request (3-second connection timeout,
  3-second command timeout). An unavailable cache falls through to scraping
  after failure. `CACHE_ENABLED=true` alone does not enable caching without
  `VALKEY_URL`; presence/reachability in production was not verified here.

Recommended next changes: define an end-to-end interactive request deadline,
propagate cancellation through source requests and retry sleeps, reserve a
shorter budget for optional enrichment, and return an explicit retryable error
when freshness cannot be met within budget. Instrument cache hit/miss/bypass,
lock-wait time and per-source attempts before changing their budgets. Evaluate
Valkey placement/availability using those measurements. Keep data publication
and source pacing correct when moving refreshes to a background worker.

## Observability added

- Worker: `api.authorization.completed` records request ID, backend, decision status and
  `durationMs` around authorization, including account-service round trip time.
- Web: `api.account_access.completed` records decision status and `durationMs`
  around database authorization, including pool queueing and query time.
- Existing `api.request.completed` records total Worker duration and cache header.

These events contain no keys, connection strings, signing secrets or user IDs.
Worker authorization and total events can be joined by request ID. Web timings
are aggregate stage measurements; a cross-service trace ID is not yet propagated.
Successful source operations and cache wait duration still need finer tracing.

## Validation and rollout

Local checks for this PR:

- `pnpm test:api`: 57 passed, 1 database-dependent test skipped (no database URL).
- `pnpm --filter @stock-market/db typecheck`: passed.
- `pnpm --filter @stock-market/web typecheck`: passed.
- `pnpm --filter @stock-market/api typecheck`: passed.
- `pnpm --filter @stock-market/api build`: passed.
- Added a shared-pool regression test covering successive decisions, per-request
  quota writes, revocation on the next lookup, database failure, and pool ownership.
- Added Hyperdrive-routing tests covering backend precedence, failure without
  fallback/double-spending, missing connection configuration, and service rollback.
- Added edge-cache tests for Valkey bypass, edge-expiry fallback to shared data,
  source freshness, key isolation, cache errors, background publication, fresh
  authorization/quota enforcement on hits, and independent bypass controls.

Deploy the **web application** to activate pool reuse and the **API Worker** to
activate authorization timing and optional Hyperdrive support. Pool reuse needs
no new binding or schema migration; activating Hyperdrive requires the setup above.
After deployment:

1. Repeat the unauthenticated probes from the same client and compare the new
   authorization timings, separating cold/idle-expired requests from warm ones.
2. With a test account, measure `/v1/coverage` (authorization without a stock
   source), repeated company search, and cold/warm full-company and extract
   requests. Record request IDs, status, cache state and latency; respect quota.
3. Compare authorization and total p50/p95/p99 at representative traffic, plus
   database connection count, queueing, `53300` errors and 503 rate. Confirm key
   revocation, plan expiry and shared quotas still behave correctly.
4. Compare the pooled account-service path with the Hyperdrive path under the
   same traffic and database placement. Verify immediate revocation, expiry,
   plan changes and exact per-account allowance counts with concurrent keys.
   Disable Hyperdrive query caching and include cold/warm samples. Use the
   breakdown to prioritize section-specific extraction, background snapshots,
   deadline enforcement, and region co-location. Sequential database queries
   may also benefit from Worker placement near the database; select a region
   only after confirming the actual database location and measuring the full path.

No production speedup is claimed until this change is deployed and measured.
If pool contention or error rate regresses, revert the shared-pool route change
and redeploy the web application; the timing logs can remain for diagnosis.
