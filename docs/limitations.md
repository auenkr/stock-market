# Current limitations and SaaS work

## Datasets that cannot be supplied from the current connections

These paths return `501 DATASET_UNAVAILABLE`, and their query/response contracts are included in OpenAPI for planning. They are not functional integrations.

- Commodity lookup/percentage changes: the supplied Basic key returned `401 ER017 - user not premium`. These datasets remain unavailable.
- Enterprise `refreshed-stocks`: needs a persisted ingestion log with dataset-specific update timestamps. Scrape/cache access times do not indicate when company filings changed.

Nine reference market-history paths are deliberately excluded, including adjusted daily stock prices, daily/annual price-ratio series, historical index prices/valuations and commodity price trends. Financial statement histories, ownership filings, and corporate events remain in scope. Offline CLI valuation jobs are separate from the public API.

### FinEdge Basic integration (2026-10-02)

Configured FinEdge personal endpoints now supply name/symbol changes, segment revenue, filing notes, ownership declarations/beneficial owners, current index feeds/master/precomputed returns and holidays. Basic company access is restricted to ITC, RELIANCE and HDFCBANK; the supplied key denied TCS. Missing credentials or plan-restricted symbols return explicit 501 errors. The adapter also fills supported Screener 501 variants; successful partial Screener responses retain their existing fields. See [provider behavior](api-compatibility.md#finedge-fallback) and [integration tests](testing.md#finedge-integration).

## Remaining gaps within working adapters

- Named current/historical holders, ownership summary/distribution, corporate actions, dividends and upcoming results now have partial Screener adapters. These are no longer wholly unavailable datasets. Ownership share counts, voting rights, pledges, warrants and other statutory fields remain null.
- Company dividend amounts are rupees per share; global dividend lists expose percentages of face value, so global amounts stay null. Adjusted historical dividends, complete action archives and exact publication timestamps remain unavailable. Company-specific rights history uses a searched, paginated market list with exact-symbol filtering.
- Balance-sheet schedules now expose inventories, receivables, cash, payables and long/short-term borrowing fields. Complete filing sublines, current/noncurrent totals and bank/insurance adapters remain incomplete.
- Upcoming results are a paginated future calendar. Historical result calendars are not supplied. Latest market-wide announcements are connected, but do not expose a stable complete historical cursor or dates for every record.
- Profitability ratios, cumulative metrics and basic P&L have Screener mappings; other supported ratio/metric/basic-statement variants use FinEdge when configured and entitled. Financial period coverage is documented per operation in Swagger.

## Source constraints observed through 2026-10-01

- Screener company pages, industry directory, peer classification pages and IPO pages were reachable. The company master screen redirects unauthenticated requests to login; it worked using the existing local source session.
- A direct NSE quote request returned HTTP 403. No NSE adapter is presented as validated. An archive request also failed in this environment.
- Some transcript links are unavailable for the source session, while presentation links are exposed. Source HTML markup, login requirements, available periods and link visibility can change.
- The supplied temporary free account was used to sign in through the shared browser. Company actions, named holder expansions, upcoming results and Market Pulse action lists were accessible. Segment values and commodity tools remain premium-gated. See [browser exploration evidence](screener-exploration.md).
- A rapid taxonomy refresh received Screener HTTP 429. The refresh command now spaces source requests; a subsequent run saved 280 classification names/paths. Source 429 is exposed as 503 `SOURCE_RATE_LIMITED`, not an empty successful dataset. Refreshing classification names is separate from market history.
- Statement values are rounded source aggregates. Detailed filing sublines and sector-specific bank/insurance schemas are not established by the new snapshot parser. Nulls and shorter field sets are explicit compatibility differences.
- Only up to 25 symbols are accepted per source-backed batch. On-demand scraping, local caches and source credentials cannot support unrestricted all-market bulk requests or reliable streaming.

## What remains for a paid API service

1. Acquire sources that allow the intended commercial distribution and cover the missing datasets. Product documentation and public test responses describe a contract; they are not a production data supply. FinEdge's pricing page distinguishes commercial licensing from personal plans: [source](https://www.finedgeapi.com/financial-data-api-pricing).
2. Persist company/security identity mappings, source provenance, parsed financial records and update timestamps. Add scheduled ingestion, retries with bounded backoff, source circuit breakers, and revision tracking. Serve customers from stored data rather than scrape on every cold request.
3. Configure the production API's PostgreSQL binding and apply account-usage migrations. Dashboard key hashes, expiry and revocation are now checked by the API; invalid keys fail closed.
4. Add detailed historical usage reporting. Better Auth + Polar monthly subscription billing, verified Basic/Personal/Professional entitlements, and the Basic top-five company allowlist are implemented. Shared per-account minute quotas (10/300/500) are enforced atomically in PostgreSQL across Worker isolates and replicas. Configure the Polar organization and deploy the billing migration as described in [Polar setup](polar-setup.md).
5. Configure production source secrets separately from source-code variables. Source sessions are read from environment/Worker bindings; browser exploration credentials are not stored in repository docs or generated Swagger.
6. Measure source freshness and endpoint latency under expected customer load. Add source health/status, request correlation, structured error reporting and operational monitoring. `/health` currently measures process availability, not upstream dataset readiness.
7. Complete field/period/sector parity against representative independently sourced fixtures. Verify real standalone/consolidated examples, financial-unit conversions, missing values, non-March fiscal years and reporting revisions. Passing route tests proves the implemented subset, not all 53 datasets.

Deployment was not requested in this change. A local build does not establish live routing, source access from Cloudflare, or which Worker version the custom domain serves.
