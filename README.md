## Stock Market API

Base URL: `https://stock-market-api.auenkr.com`

The API provides structured Indian equity and IPO data for applications. The versioned API is available under `/v1`; the existing `/api` paths remain available for compatibility.

### Health and contract

`GET /health` returns service status. `GET /swagger.json` and `/openapi.json` return the same OpenAPI 3.0.3 contract. The API's `/docs` page reads that contract; the web `/docs` explorer includes search, coverage filters, request forms, schema browsing, and a request runner.

The development API limits requests to 60/minute per supplied key or Cloudflare client IP, per Worker isolate. Dashboard-managed keys are stored in PostgreSQL and shown only once, but the API does not yet validate those keys or enforce paid plans.

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

Open `http://localhost:3001`. API keys are shown only once at creation and stored as SHA-256 hashes.

## Development validation

```bash
pnpm test:api
pnpm typecheck
pnpm --filter @stock-market/api build
```

For source-backed smoke checks, configure the root `.env` from `sample.env`, then run:

```bash
node --env-file=.env --import tsx apps/api/scripts/smoke.ts
```

`pnpm dev:api` loads source credentials from the root `.env`; `apps/api/.dev.vars` can override them. Production uses Worker secret bindings. Source credentials are not customer API keys.
