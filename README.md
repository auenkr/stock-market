## Stock Market API

Base URL: `https://stock-market-api.auenkr.com`

The API provides structured Indian equity and IPO data for applications. The versioned API is available under `/v1`; the existing `/api` paths remain available for compatibility.

### Health and contract

`GET /health` returns service status. `GET /swagger.json` and `/openapi.json` return the same OpenAPI 3.0.3 contract. The API's `/docs` page reads that contract; the web `/documentation` overview explains free/paid access and rate limits, and links to the `/docs` API reference with search, tier filtering, request forms, schema browsing, and a request runner.

The API validates dashboard-issued keys against PostgreSQL, including expiration and revocation. Allowances are **10 requests/minute for Basic, 300 for Personal, and 500 for Professional**, shared across all account keys and API instances using atomic database counters. Personal (₹2,000/month) and Professional (₹5,000/month) unlock all endpoints; Professional also permits commercial use. Better Auth + Polar handle monthly checkout, billing portal, and verified subscription synchronization. See [Polar account setup](docs/polar-setup.md).

### Endpoint tiers

The endpoint catalog and docs explorer divide operations into **Free** and **Paid** tiers. Free covers discovery, profiles, quotes, basic financials, peers, calendars, and service endpoints. Paid covers detailed financials, ownership, corporate disclosures, commodities, full company datasets, and enterprise batches. Aliases inherit their canonical tier. See [the tier matrix](docs/api-compatibility.md#endpoint-tiers). OpenAPI includes `x-tier` and `x-api-style`; free accounts can access company endpoints only for RELIANCE, HDFCBANK, BHARTIARTL, ICICIBANK, and SBIN (top five by market capitalization at 2026-10-01 close). Other free discovery/calendar/service endpoints remain accessible. Paid accounts can use all tiers and companies, subject to source coverage.

### FinEdge-style resource API

The API exposes the non-history personal and enterprise contracts inventoried from the [FinEdge documentation](https://www.finedgeapi.com/financial-data-api-documentation). Compatibility routes preserve resource-specific response shapes rather than adding the legacy `data` envelope.

There are 53 non-history reference paths: 36 have partial source-backed adapters and 17 return explicit `501 DATASET_UNAVAILABLE`. Nine market-history paths are excluded. Newly connected Screener data includes named ownership, shareholder summaries/distributions, corporate actions, dividends, and upcoming results. This is not complete dataset or field parity. See [docs/](docs/README.md) for the full endpoint matrix, progress, limitations, and remaining SaaS work.

```bash
curl 'https://stock-market-api.auenkr.com/v1/company-profile/ITC'
curl 'https://stock-market-api.auenkr.com/v1/financials/ITC?statement_type=c&statement_code=pl&period=annual'
curl 'https://stock-market-api.auenkr.com/enterprise/api/company-profile?symbols=ITC,RELIANCE'
curl 'https://stock-market-api.auenkr.com/v1/coverage'
```

Personal `/v1` endpoints also support `/api/v1`; the new quote endpoint supports `/v2/quote` and `/api/v2/quote`. Enterprise routes use `/enterprise/api`. Missing fields are null; quotes are delayed snapshots. Market-wide corporate-action lists and the latest announcement feed are connected; unrestricted historical feeds are not. Statement amounts are rupees, profile/quote market caps are crores, profitability ratios are fractions, and ownership percentages remain percentages. The current source-backed batch limit is 25 symbols.

These docs describe local code; this change has not been deployed. Check the target server's `/openapi.json` and `/v1/coverage` before relying on its deployed coverage.

### Regenerate Swagger and docs

```bash
pnpm docs:generate  # root swagger.json, web download, endpoint coverage table
pnpm docs:check     # fail if generated artifacts differ from the contract
pnpm source:taxonomy  # refresh Screener classification names using local .env
```

The web explorer imports [swagger.json](swagger.json), generated from the API contract. Source credentials remain in local environment/Worker secrets. The docs default to `http://localhost:8787`; set `NEXT_PUBLIC_API_URL` for the web request runner, or edit its API server field. See [docs/swagger.md](docs/swagger.md) for contract maintenance.

### List companies

`GET /v1/list-of-company?page=1`

The optional `page` parameter is a positive integer. Each page contains up to 100 companies.

```bash
curl "https://stock-market-api.auenkr.com/v1/list-of-company?page=1"
```

Company rows expose the source `url`, without `symbol` or the internal `skip` flag. The response contains only `{meta, data}`. Pagination is in `meta`: `currentPage`, `limit`, `count`, `isNextPageAvailable`, `nextPage`, and `previousPage`. Page size is fixed at 100; unavailable next/previous pages are `null`.

### List upcoming IPOs

`GET /v1/list-of-ipo`

Returns the available upcoming IPO listings.

```bash
curl "https://stock-market-api.auenkr.com/v1/list-of-ipo"
```

### Search companies

`GET /v1/company-search?q=<company-name>`

The `q` parameter is required and can contain part of a company name.

```bash
curl "https://stock-market-api.auenkr.com/v1/company-search?q=reli"
```

### Get company data

`GET /api/company-data?companyUrl=<company-path>` (also `/v1/company-data`)

The required `companyUrl` parameter accepts the original relative `url` from company listing or search results. Paths such as `/company/id/1286218/`, `/company/RELIANCE/`, and `/company/RELIANCE/consolidated/` are fetched as supplied; the API does not construct a path from a symbol. Absolute URLs and non-company paths are rejected. Use query encoding for paths containing `&`, such as `/company/GVT&D/`.

```bash
curl --get "https://stock-market-api.auenkr.com/v1/company-data" \
  --data-urlencode "companyUrl=/company/id/1286218/"
```

```js
const query = new URLSearchParams({ companyUrl: company.url });
const response = await fetch(`/v1/company-data?${query}`);
```

This request can take around 20 seconds on a cache miss. It returns `{data, companyData}` with the same object in both fields and caches it for 15 minutes. The former `symbol` and `endpoint` inputs no longer satisfy this route.

Invalid query parameters return a JSON response with an `error` field and an appropriate HTTP status code.

### Extract focused financial data

`GET /v1/extract?endpoint=/company/<company-endpoint>&type=<type>`

The extraction endpoint exposes focused datasets from the full company response. Supported types are `quarterly`, `profit-loss`, `balance-sheet`, `cash-flow`, `ratios`, `shareholding`, and `peers`. Market history is excluded; public company requests do not download price charts.

```bash
curl "https://stock-market-api.auenkr.com/v1/extract?endpoint=/company/RELIANCE/consolidated/&type=balance-sheet" \
  -H "X-API-Key: sm_live_your_key"
```

## Local development

Copy `sample.env` to `.env` and configure a valid Screener `COOKIE`. Run all four long-lived applications with:

```bash
pnpm run dev
```

The command loads the root `.env`, starts all four Nx dev tasks concurrently, and streams prefixed logs. The API, dashboard, orchestrator and worker reload when their source changes; shared scraper/common source changes are also watched. The CLI is an on-demand job (`pnpm scrape` / `pnpm metrics`), not a dev server.

Default URLs are API `http://localhost:8787`, dashboard `http://localhost:3001`, and orchestrator `http://localhost:3000`. Override them using `API_PORT`, `WEB_PORT`, `ORCHESTRATOR_PORT` and `ORCHESTRATOR_URL` in `.env`; use distinct ports. `pnpm dev:api`, `pnpm dev:web`, `pnpm dev:orchestrator` and `pnpm dev:worker` use the same environment setup.

The API dev launcher passes only source/API bindings to Wrangler using a temporary private file; credentials are hidden in Wrangler's binding output. Optional `apps/api/.dev.vars` values override the root API bindings. Restart the dev command after changing `.env` or `.dev.vars` so processes reload credentials and ports. Production source credentials use Worker secrets.

API and orchestrator logs include request IDs, method/path, status and elapsed time. The API returns `X-Request-ID` for correlating responses with logs. Upstream retries log the source path, attempt, delay, error code and HTTP status without headers or response bodies. Expired source sessions return `502 SOURCE_AUTH_REQUIRED`; other upstream failures return `502 UPSTREAM_UNAVAILABLE`, and missing source resources return 404. Optional news/GMP failures are logged while the primary response remains available.

The orchestrator initializes an empty queue on a fresh checkout. Populate it before expecting worker jobs; the worker polls when idle, retries connection failures, and skips source companies that return 404.

## Developer Dashboard

The Next.js dashboard lives in `apps/web` and provides Better Auth sign-in, Drizzle-backed API-key management, and product documentation.

Start PostgreSQL and create the schema:

```bash
docker compose up -d postgres
DB_CONNECTION_URL="postgresql://stock_market:stock_market@localhost:5432/stock_market" pnpm db:push
```

Start the dashboard with the same single application setting:

```bash
DB_CONNECTION_URL="postgresql://stock_market:stock_market@localhost:5432/stock_market" pnpm dev:web
```

Open `http://localhost:3001`. New accounts complete a profile form with a required name and optional company before accessing the dashboard. Saved profiles are reused on subsequent sign-ins. API keys can be revealed or copied from the dashboard after a reload; their hashes are used for verification and their secrets are encrypted at rest. The docs explorer shares an entered `X-API-Key` across all endpoint request forms for the current page session.

New user, session, account, verification, and API-key IDs use UUIDv7 for time-ordered database indexing. Existing IDs and references are preserved.

### Google sign-in

Set these server environment variables in the root `.env` locally and in your hosting environment for production:

```dotenv
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_SECRET=<a-random-secret-of-at-least-32-characters>
API_KEY_ENCRYPTION_SECRET=<a-different-random-secret-of-at-least-32-characters>
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<your-google-oauth-client-secret>
```

Generate the auth secret with `openssl rand -base64 32`. Keep it stable between deployments; changing it signs users out. `BETTER_AUTH_URL` must be the actual dashboard origin, including your configured `WEB_PORT` locally; use the HTTPS dashboard domain in production. `WEB_URL` can contain comma-separated additional trusted dashboard origins. Both Google credentials are required to enable the Google button. Password authentication is enabled only when `ENVIRONMENT=dev`; it is disabled for every other value or when unset.

Generate `API_KEY_ENCRYPTION_SECRET` separately with `openssl rand -base64 32` and keep it stable. If it is omitted, the dashboard derives the encryption key from `BETTER_AUTH_SECRET`. API keys are encrypted at rest so their owners can reveal or copy them from the dashboard after a reload. Losing or changing the configured encryption secret (or the auth secret when using the fallback) prevents existing encrypted keys from being revealed.

Create a **Web application** OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and register the exact redirect URI `http://localhost:3001/api/auth/callback/google` locally and `https://<your-dashboard-domain>/api/auth/callback/google` in production. Add your accounts as test users if the consent screen is in testing mode. This follows [Better Auth's Google configuration](https://www.better-auth.com/docs/authentication/google). Restart the web server after changing environment variables.

Google fills the initial name and email. First-time users are sent to `/onboarding`; returning users go to `/dashboard`. Accounts that leave onboarding unfinished must complete it when they return. A Google account matching an existing unverified email/password account must use its existing email login.

### Upgrade an existing dashboard database

To remove unused API-key columns, run `pnpm db:migrate:simplify-api-keys`, then `pnpm db:migrate:timestamps` and `pnpm db:migrate:key-expiration`, in that order. The table retains only `id`, `user_id`, `name`, `key_hash`, `encrypted_secret`, `expires_at`, `created_at`, `updated_at`, and `revoked_at`. The prefix is derived when displaying a key; unused usage timestamps and per-key allowances are removed. Expiration is now used by key creation: 1, 7, 30, or 90 days, or `NULL` for no expiration. Existing keys default to no expiration. Policy settings live once in `usage_policy`, not on each key. Application timestamps default to the current time; database triggers refresh `updated_at` on key and policy changes, including manual SQL updates. Authentication tables retain Better Auth's required fields and existing creation/update metadata.

Key creation uses a dialog with a required name and expiration choice. The server calculates the deadline; the dashboard displays expiration, excludes expired keys from the active count, and removes their reveal/copy actions. The data API validates the stored key hash, rejects expired/revoked keys, and charges requests to the key owner's shared account allowance.

### Shared UI components

`packages/ui` contains the shared shadcn/ui components (Dialog, Button, Input, Label, RadioGroup, and Select), their Radix primitives, and Tailwind styles. Import components using `@stock-market/ui/components/<name>` and load `@stock-market/ui/styles.css` once in an application's stylesheet. The dashboard transpiles the package directly; Tailwind's preflight reset is omitted to preserve existing application styles. Theme tokens reuse the dashboard's light/dark CSS variables.

The package also exports `PageMotion` from `@stock-market/ui/motion`. The homepage progressively enhances its server-rendered content with Motion entrances, one-time scroll reveals, spring card hovers, and pointer-following code-panel labels. Motion loads only on pages that opt in, respects changes to `prefers-reduced-motion`, and keeps content visible without JavaScript. `/` and `/docs` are prerendered at build time; the docs use Fuse.js fuzzy endpoint search, shared Select controls, and short CSS endpoint/control transitions without loading Motion. The dashboard animates card entrances, saved key rows, and key reveals. The single theme button defaults to the system preference and reveals a toggled theme outward from the button using View Transitions, with an immediate fallback for reduced motion or unsupported browsers.

For old databases, apply `pnpm db:migrate:request-limit`, `pnpm db:migrate:account-usage`, `pnpm db:migrate:api-plans`, then **`pnpm db:migrate:billing`**, in that order after the timestamp migration. The final migration installs the three plans and consent fields; legacy manual Paid flags become Basic until a verified subscription activates paid access. Do not rerun the old API-plan migration after billing. The web backend uses `DB_CONNECTION_URL` from the root `.env`. Local Workers send timestamped, HMAC-signed requests to `/api/internal/account-access`; their scoped signing secret is derived from `BETTER_AUTH_SECRET` unless `ACCOUNT_SERVICE_SECRET` is configured. For production, set a dedicated `ACCOUNT_SERVICE_SECRET` on both services, configure the Worker's `ACCOUNT_SERVICE_URL` to the deployed web endpoint, and store its signing secret with `pnpm --filter @stock-market/api exec wrangler secret put ACCOUNT_SERVICE_SECRET`. Authorization fails closed if account storage or the signed service is unavailable. Health and OpenAPI stay public.

```bash
pnpm dlx shadcn@latest add <component> --cwd packages/ui
pnpm --filter @stock-market/ui typecheck
pnpm test:keys
```

### Development password login

Set these values in your local `.env`:

```dotenv
ENVIRONMENT=dev
DEV_USERNAME=dev
DEV_PASSWORD=ledgerline-dev-password
```

Run `pnpm db:seed:dev`, restart the dev server, and sign in at `/signin` using the username and password. The seed is repeatable, hashes the password, and creates a profile-complete testing account. Usernames map to `<username>@auenkr.com` internally, so no extra username column is needed. Public password signup remains disabled. Set `ENVIRONMENT=production` on production deployments.

### Profile migration

Before running `pnpm db:push` against a database created before profile onboarding was added, apply the migration once. This command reads `DB_CONNECTION_URL` from the root `.env`:

```bash
pnpm db:migrate:onboarding
```

The migration adds the profile fields, preserves access for existing users, and requires profile completion for future accounts. For a fresh database, `pnpm db:push` creates the full schema directly. Apply the schema before deploying the updated dashboard.

Before deploying persistent API-key reveal, run `pnpm db:push` to add the nullable `encrypted_secret` column to existing databases. Previously created keys cannot be recovered because they were stored only as hashes; create replacements for those keys.

## Development validation

See [integration and k6 performance testing](docs/testing.md) for disposable database setup, flow coverage, workload scenarios and cleanup.

```bash
pnpm test:integration
pnpm test:e2e
pnpm test:performance
SCENARIO=quota pnpm test:performance
```

```bash
pnpm test:api
pnpm test:auth
pnpm typecheck
pnpm --filter @stock-market/api build
```

For source-backed smoke checks, configure the root `.env` from `sample.env`, then run:

```bash
node --env-file=.env --import tsx apps/api/scripts/smoke.ts
```

`pnpm dev:api` loads source credentials from the root `.env`; `apps/api/.dev.vars` can override them. Production uses Worker secret bindings. Source credentials are not customer API keys.
