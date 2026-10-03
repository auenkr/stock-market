# Swagger and API docs maintenance

The canonical generated artifact is [../swagger.json](../swagger.json), OpenAPI 3.0.3. It includes active personal paths, aliases, Internal discovery/extraction and service routes, parameters, examples, response models, errors and coverage notes. Operations are grouped into Search, Company overview, Finance, and Internal. The generated coverage table contains current counts.

The API exposes the same contract at `/swagger.json` and `/openapi.json`, with its current request origin as the server. `/docs` on the Worker is a self-contained searchable contract viewer. Both viewers group endpoints by use case, beginning with company-name search and basic information. The web `/docs` page imports the generated Swagger and offers use-case and tier filters, endpoint search, parameter forms, code copying, response status selection, schema browsing and explicit request execution. Unknown datasets display their 501 contract; they are not shown as successful integrations.

## Source of truth

- `apps/api/src/endpoint-catalog.ts`: paths, parameters, resource shapes and status.
- `apps/api/src/endpoint-journey.ts`: ordered use-case groups and canonical endpoint order, including legacy and service routes. OpenAPI tags use these groups; `x-tier` retains plan access. Aliases inherit `x-use-case` and `x-order` from the canonical operation.
- `apps/api/src/coverage-details.ts`: source-supported variations and missing fields, displayed in the explorer.
- `apps/api/src/reference-schemas.ts`: compatibility resource field schemas.
- `apps/api/src/legacy-schemas.ts`: original company, statement, directory and IPO types, including their response envelopes and units.
- `apps/api/src/openapi.ts`: OpenAPI generation, richer PL/BS/CF variants, action variants, error models and conventions.
- `apps/api/scripts/generate-swagger.ts`: writes the full development contract at root Swagger, `docs/endpoint-coverage.md`, and `docs/endpoint-journey.md`.
- `packages/common/src/api-reference.ts`: filters Internal operations, groups, unused schemas, and coverage counts outside `ENVIRONMENT=dev`. Both the API and web docs use it.
- `apps/web/src/app/swagger.json/route.ts`: serves the environment-filtered downloadable contract; a public static file cannot bypass the environment rule.

```bash
pnpm docs:generate
pnpm docs:check
pnpm test:api
pnpm typecheck
```

Update the source contract, journey classification, and adapter together, then regenerate. Do not manually edit generated JSON, the journey guide, or the coverage matrix. `docs:check` detects stale artifacts. API tests verify reference path registration, schema references, unique operation IDs, use-case classification/order across aliases, and matching `/swagger.json`/`/openapi.json` responses.

## Server selection

Generated Swagger defaults to `http://localhost:8787`. Set `PUBLIC_URL` when generating for a different documented server. For the web request runner, `NEXT_PUBLIC_API_URL` overrides the default at build time; the server field can also be edited per session. Requests are made only when **Send request** is clicked. API keys are kept in component memory, referenced through environment variables in copied examples, and not persisted by the docs UI. Data requests require a valid dashboard-issued key; all keys belonging to an account share its 10/minute Basic, 300/minute Personal, or 500/minute Professional allowance. Basic company endpoints are limited to RELIANCE, HDFCBANK, BHARTIARTL, ICICIBANK, and SBIN; paid endpoints and other companies require Personal or Professional. Health and OpenAPI are public.

Response examples are synthetic schema illustrations, explicitly labeled, not live observations. The request runner displays actual HTTP status and response data from the selected server. Legacy operations declare `x-timeout-ms: 60000`; the runner uses this allowance for slow full-company/schedule requests instead of aborting them after 15 seconds. Each individual upstream request still has its own 15-second source timeout. The development web page and downloadable contract do not prove that a production API has been deployed.

The web explorer keeps each endpoint's parameter inputs, code language, selected view, and latest request/response in memory for the current page session. Switching endpoints, filters, or hash history restores that workspace without a network request. Pending requests continue in their own workspace while another endpoint is open; return to the endpoint to view or cancel them. **Send request** explicitly makes a fresh request and replaces that endpoint's previous result. Reloading or leaving the page clears these workspaces. API keys are not persisted to browser storage.

## Recent API changes

Company search returns URL-valued `symbol` instead of `url`. Company overview and Finance endpoints accept only `symbol`; the path selects standalone/consolidated data. Profile, basic finance, grouped documents, peer comparison, quarterly/annual P&L, balance sheet, cash flow, ratios, and shareholding have dedicated operations. Supplementary operations are under Internal. API coverage and response headers omit provider attribution.

All company endpoints, including Internal `company-data`, extraction, ownership and dividends, use URL-valued `symbol`. Company listing and upcoming IPO rows also return `symbol` instead of `url`. Company-data additionally returns `website`; extraction metadata contains `symbol` instead of `endpoint`. Encode paths with `URLSearchParams` or `curl --data-urlencode`. Absolute URLs, non-company paths and traversal are rejected.

Company lists return `{meta, data}`; rows contain `symbol` without `url` or `skip`. Pagination appears only in `meta`: `currentPage`, `limit`, `count`, `isNextPageAvailable`, `nextPage` and `previousPage`.

`/api/extract` and `/v1/extract` accept `symbol` and `type`. Company-data and extraction share a 15-minute cache; `X-Cache: HIT` is present on a hit. Account-scoped responses use `Cache-Control: no-store`.

Swagger includes `X-Request-ID`, quota retry information and legacy 400/404/429/500/502 errors. Legacy values retain `{amount, baseValue}`; missing cells may become zero and absent source rows may be omitted. These differ from compatibility resources, which use rupees and null for missing financial values. Public legacy `metrics` remains empty; optional news/GMP failures preserve the main response.
