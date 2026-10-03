# Implementation progress

## Identifier cleanup and dev-only Internal docs — 2026-10-03

- Unified company identifiers across every API: company search/listing and upcoming IPOs return URL-valued `symbol`; older company-data/extraction, ownership, dividends and corporate actions accept it directly. Company-data returns `website` separately; extraction metadata uses `symbol`.
- Moved shareholding distribution into Finance with only `symbol`, defaulting to quarterly.
- Removed the requested name/symbol changes, segment revenue, notes, financial metrics, declaration/beneficial-owner, index master/current price/returns, commodity lookup/percentage-change, IPO-calendar and holiday-calendar routes and related schemas/source branches.
- Replaced action path parameters with optional `action=split|bonus|rights|dividend`. Default company actions include all available types, including paginated rights. Rights match standalone, consolidated and numeric-ID company paths; later pages avoid repeating modal records.
- Shared environment-aware documentation filtering hides Internal operations and unused schemas unless `ENVIRONMENT=dev`. API contracts, web overview/playground and downloadable Swagger use the same rule. The static web contract was replaced with a filtered route.
- Confirmed results calendar uses the configured source's upcoming-results page; upcoming IPOs use its IPO listing and optional InvestorGain GMP enrichment. Removed IPO calendar used the IPO listing; holiday calendar had no connected source.
- Validation: 37 API tests passed, 1 optional live test skipped; 20 HTTP/database integration tests passed; 3 playground browser tests passed in each of dev and production; k6 smoke thresholds passed; API/common/scraper/web and integration-test typechecks, API build, generated-doc checks and diff checks passed.

## API restructuring — 2026-10-03

- Organized the API into Search, Company overview, Finance, and Internal. Supplementary routes remain under Internal with their existing parameters and access tiers.
- Search returns the original company URL path as `symbol`, replacing `url`; company endpoints pass it through without extracting a ticker. Company overview and Finance accept only one required `symbol` query parameter.
- Removed stock-symbol/classification-search routes, taxonomy tooling/data, separate quote routes, generic financial statements, and separate document routes, including obsolete schemas and source branches.
- Basic finance now combines summary, about, key points, current price data, and pros/cons. Historical metrics are in dedicated quarterly/annual P&L endpoints. Documents are grouped into one response.
- Finance has dedicated peer comparison, quarterly/annual P&L, balance sheet, cash flow, ratios, and quarterly shareholding endpoints. OpenAPI, both references, request examples, and regression fixtures follow this contract.
- Removed provider attribution from coverage metadata, response headers, OpenAPI external links, and authentication/rate-limit error messages.
- Validation: 34 API tests passed, 1 optional live test skipped; 20 HTTP/database integration tests passed; 10 browser tests passed; k6 smoke thresholds passed; API/scraper/web and integration-test typechecks, API build, generated-doc checks, and diff checks passed.

## Use-case endpoint ordering — 2026-10-03

- Inspected Screener's company-name search and Reliance company page. Matched the overview → peers → statements → ratios → investors → documents section order.
- Added a shared endpoint journey registry covering personal, legacy, and service routes. Both API references, Swagger, coverage metadata, and generated guides use this classification and order.
- The reference opens on company-name search and supports use-case and Free/Paid filters. Financial statements document quarterly P&L → annual P&L → balance sheet → cash flow query selections.

## Personal API cleanup — 2026-10-03

- Removed all 19 enterprise paths and their batch/feed schemas and source mappings.
- Removed the secondary data provider, fallback routing, provider-specific tests, and local/sample environment bindings. Screener is the sole runtime data source.
- The current catalog has **43 personal paths: 25 partial, 12 unavailable, and 6 excluded**. Generated Swagger and coverage documentation reflect this inventory.
- Entries below record historical implementation and validation; their endpoint counts describe those earlier versions.

## 2026-09-30

Goal: build an independent financial-data API SaaS with documented financial endpoint contracts, excluding market history, and maintain explicit progress and limitations in this directory.

Completed:

- Explored the product, pricing and documentation in the shared computer-use browser, including both personal/enterprise documentation tabs. Read the financial field reference and visually inspected its balance-sheet field table.
- Inventoried 43 personal + 19 enterprise reference paths. Nine history paths are excluded. Registered the other 53 paths and personal `/v1`/`/v2` aliases.
- Added 25 partial source-backed contract adapters (including enterprise variants); 28 remaining contract paths explicitly return 501. No competitor API is used as a runtime source.
- Added a lightweight Screener snapshot parser for company identity/classifications, numeric financial tables and document links. It does not download market-price charts or classify company search suggestions as news.
- Added response-specific financial/profile/quote/ownership/report/IPO mappings, unit conversion, null handling, required argument/enumeration/date/symbol validation, bounded batch sizes, pagination, bounded/coalesced source caching and explicit upstream errors.
- Generated OpenAPI success/error contracts from the same endpoint registry as the routes. Added `/v1/coverage`. Corrected the contract's authentication description to reflect that key validation remains pending.
- Removed public price-history extraction and disabled chart downloads from legacy public company requests. Consolidated legacy schedules now retain the requested statement type. Existing CLI price-history behavior remains available for its valuation workflow.
- Maintained the developer-facing website and repository docs with current endpoint/coverage information and SaaS limitations.

Validation is recorded below after execution. A registered route returning 501 is tracked as a gap, not a completed dataset. See [endpoint coverage](endpoint-coverage.md) and [compatibility differences](api-compatibility.md) for the actual supported subset.

## Validation completed 2026-10-01

| Check | Result |
| --- | --- |
| `pnpm test:api` | 10 tests passed. Includes every reference route and alias, response field shapes, monetary conversion, TTM/annual separation, query validation, batching/pagination, coalescing, upstream errors, rate limits and disabled public market-history downloads. |
| `pnpm typecheck` | All nine workspace projects passed. The API typecheck was repeated after the final test additions and passed. |
| `pnpm --filter @stock-market/api build` | Cloudflare-targeted ESM bundle built successfully (about 938 KB before compression). |
| `node --env-file=.env --import tsx apps/api/scripts/smoke.ts` | 20 live source-backed requests returned 200. Checked ITC standalone/consolidated financials, P&L/BS/CF, profitability/cumulative/basic financials, quote, reports, peers, classification search, ownership pattern, announcements, ratings, presentations, IPOs, directory, and two-company enterprise profile/quote batches. |
| Live transcript availability | ITC returned 501 because transcript links were unavailable in the source session. This is a documented conditional gap, not a failed successful-response assertion. |
| Website docs compilation | `/docs` compiled and returned HTTP 200 on a temporary local validation server. Rendered HTML contains all 53 non-history endpoint cards, including partial-data and missing-source labels. |
| Browser inspection | Reference product, pricing, and both documentation tiers were explored successfully. After temporary preview timeouts, the shared browser reconnected. Inspected the local documentation at desktop and phone widths; corrected the missing code-block styling class and verified no page-level horizontal overflow at 390 pixels. |

Live checks used the existing local source session without printing credentials or retaining raw source responses in the repository. Validation does not establish access from Cloudflare, a production SLA, complete field parity, billing/key enforcement, or deployment. No deployment was performed.

## Screener expansion and Swagger docs — 2026-10-01

Completed:

- Used computer use to explore Screener, sign in with the supplied temporary free account, inspect upcoming results, ownership expansions, company actions, index constituents and premium gates. [Exploration notes](screener-exploration.md) record observed paths and the datasets that remain unavailable.
- Added 11 more partial reference adapters (including enterprise variants): named current/history ownership, ownership summary/distribution, company/global corporate actions, dividends and upcoming results. Coverage is now **36 partial / 17 unavailable / 9 excluded** across the 62 reference paths.
- Expanded ownership patterns with disclosed holder names and percentages, annual yearly tables, and explicit missing-period nulls. Expanded annual BS with source inventories, receivables, cash, trade payables and long/short-term borrowings.
- Added latest market-wide announcements with source summaries/timestamps where present. Added a reproducible 280-entry classification taxonomy supporting all four search levels. Source throttling is explicit 503 `SOURCE_RATE_LIMITED`; refresh/live probes space source requests.
- Generated root `swagger.json` and the identical web download from OpenAPI 3.0.3, version 1.2.0. Extended PL/BS/CF and action variant schemas, parameter examples/descriptions, unique operation IDs, pagination/error headers, units and operation-specific coverage.
- Rebuilt web `/docs` from Swagger: searchable tier/coverage navigation, parameter forms, cURL copying, response examples/schema browsing and explicit requests to a configurable API server. Added Worker `/docs` and `/swagger.json`; `/openapi.json` remains an alias. Coverage docs are generated from the same contract, checked by `pnpm docs:check`.
- Updated API documentation, missing-data notes, examples and regeneration commands. Browser credentials are not written to repository files or docs. Market-price history remains excluded.

Validation:

| Check | Result |
| --- | --- |
| `pnpm test:api` | 20 tests passed, including expanded schedules/units, zero vs missing ownership values, action dates/ratios, calendars/pagination, source rate limits, all reference routes/aliases, unique operation IDs and schema references. |
| `node --env-file=.env --import tsx apps/api/scripts/smoke-expansion.ts` | 19 live requests returned 200 with non-empty mapped records. ITC: 12 expanded annual BS periods, 21 quarterly/26 annual disclosed holders, 15 current owners, 30 dividends, 3 bonuses, 1 split. Natco rights: 1 record. Results: 25 records and a next-page cursor. Macro/industry/sector search and latest market announcements also passed. |
| `pnpm typecheck` | All nine workspace targets passed (three unchanged targets reused Nx cache). |
| `pnpm --filter @stock-market/api build` | Cloudflare-targeted ESM bundle passed, about 1,000 KB before compression. |
| `STOCK_MARKET_NEXT_DIST=.next-codex-build pnpm --filter @stock-market/web build` | Production build passed; `/docs` prerendered as static content. Isolated output avoids overwriting the active development build. |
| `pnpm docs:check` | Root Swagger, web download and endpoint matrix match the source contract. |
| Browser docs checks | Search selected dividend routes; schema view rendered fields. Request runner returned live `HTTP 200 · partial` for ITC dividends. Inspected desktop (1280 px) and mobile (390 px) screenshots and verified no page-level horizontal overflow. |

Source/coverage limits remain explicit: free-account segment and commodity gates, conditional transcript access, statutory declaration/beneficial-owner records, index code/feed parity, holiday/name/symbol event datasets and persisted refresh logs. No deployment was performed; local builds and live source checks do not establish the production domain's active version.

## Accommodated API changes — 2026-10-01

- Reviewed the changed API handlers, source helpers and regression tests. Company-data now requires one trimmed/uppercased `symbol` on both `/api` and `/v1`, constructs an encoded consolidated source path, and rejects the previous endpoint-only input. Extraction retains its `endpoint`/`type` inputs.
- Extended Swagger with all five actual legacy response envelopes and detailed company, statement, directory and IPO models. Preserved source field spellings and `{amount, baseValue}` units; documented legacy zero/omitted-field behavior separately from compatibility nulls. Added cache, request ID, retry and upstream error documentation.
- Made aliases searchable and visible in both docs viewers. The web runner reads the 60-second allowance from Swagger for legacy operations so a cold full-company request is not aborted at 15 seconds. The API's individual source-request timeout remains 15 seconds.
- Regenerated both Swagger artifacts and the endpoint matrix. Updated README examples, API compatibility notes and Swagger maintenance instructions.

Validation: all 20 API tests passed, including actual response envelopes checked against Swagger and encoded symbols; all nine workspace typechecks passed; API and web production builds passed; `docs:check` and `git diff --check` passed. Live `GET /api/company-data?symbol=RELIANCE` returned 200 in 19.9 seconds, with 13 P&L periods, 12 balance sheets, matching `data`/`companyData`, a request ID, private 15-minute cache control and zero market-history records. In the production docs preview, searching `/api/company-data` found one operation, its form exposed only `symbol`, and the request runner returned HTTP 200 from the `/v1` alias. Response view showed both envelope fields and an empty synthetic `metrics` array. Mobile viewport checks passed at 390 pixels without page-level horizontal overflow.

The cold web-runner request using lowercase `symbol=reliance` also returned 200 after 20.1 seconds, verifying normalization and the extended browser timeout. The Worker docs viewer found the `/api/company-data` alias, displayed its single symbol parameter and included request-ID response headers.

The final coverage remains 36 partial, 17 unavailable and 9 excluded reference paths. Missing datasets and SaaS infrastructure remain tracked in [limitations](limitations.md). No deployment was performed.
## Monthly subscriptions and legal consent (2026-10-02)

- Added Basic (existing 10/minute), Personal (₹2,000/month, 300/minute), and Professional (₹5,000/month, 500/minute with commercial use).
- Integrated the Better Auth Polar plugin for authenticated checkout, customer creation, billing portal, and verified subscription/customer-state updates. Access expires at the paid-period deadline; retries and delayed events are safe.
- Added public pricing, Terms of Service, Privacy Policy, and Plans & billing pages. Google signup requires explicit acceptance with server-verified consent and stored policy versions.
- Added an upgrade migration, a detailed [Polar account setup guide](polar-setup.md), billing integration/migration tests, and a disposable-database E2E suite. Pre-push checks now include full E2E coverage.
