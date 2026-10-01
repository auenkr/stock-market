# API compatibility

The competitor reference is [FinEdge's documentation](https://www.finedgeapi.com/financial-data-api-documentation), inspected through its browser UI on 2026-09-30. Endpoint names, arguments, resource envelopes, and field names are compatibility targets. Runtime data comes from the independently configured Screener source.

## Routes and shapes

Personal endpoints support both `/api/v1/...` and `/v1/...`. The newer quote endpoint supports `/api/v2/quote` and `/v2/quote`. Enterprise endpoints use `/enterprise/api/...`.

Compatibility responses retain their resource shapes: stock symbols are an array, profiles are objects, quotes are keyed by symbol, financial statements use `{ "symbol": "...", "financials": [...] }`, reports use `reports`, and shareholding patterns use `columns` and `rows`. The reference spelling `catagory` and metric label `Cummulative` are preserved.

The original five discovery/extraction endpoints are available under `/v1` and `/api`. Company lists return only `{meta, data}` with original `url` fields, no `symbol` or `skip`, and pagination only in `meta` (`currentPage`, `limit`, `count`, `isNextPageAvailable`, `nextPage`, `previousPage`). `/extract?type=price-history` is no longer supported. `/company-data?companyUrl=/company/id/1286218/` fetches the supplied relative company path unchanged (the `companyUrl` parameter replaces `symbol` and `endpoint`) and does not request price charts; its legacy `metrics` array is empty. Offline CLI valuation jobs retain their existing optional price-history behavior.

Legacy company-data responds with `{data, companyData}` containing the same object; extraction retains `{data, meta: {endpoint, type, cached}}`. These two routes share a 15-minute cache and return `X-Cache: HIT` on reuse. Their financial values retain `{amount, baseValue}` and original field spellings such as `reservers` and `fiexedAssets`. Legacy blank/unparseable numeric cells may become zero and source rows may be absent; the null and rupee conventions below apply to compatibility resources. Every API response includes `X-Request-ID` for log correlation.

On compatibility resources, unknown query parameters, malformed symbols, invalid enum values, invalid dates, reversed date ranges, and invalid page numbers return 400. Dates use `YYYY-MM-DD`. `symbol`/`symbols` lists support comma-separated values or JSON arrays; quotes also accept repeated `symbol` parameters. Path parameters accept one symbol. The source workload is limited to 25 unique symbols per request; larger batches return 501 until a stored dataset supports them. Single-symbol enterprise requests retain the documented object; multiple-symbol enterprise requests return an array of per-symbol resources. Enterprise quotes return a flat array. The reference enterprise examples only show one symbol, so the multi-symbol envelope is an explicit local convention. Legacy company-data requires a relative `companyUrl` from list/search results, supports symbol-based and numeric-ID paths with optional `/consolidated/`, and rejects absolute URLs and non-company paths. URL-encode the query value to preserve ampersands; unlike compatibility resources, legacy routes do not reject every unknown query key.

```bash
curl 'http://localhost:8787/api/v1/company-profile/ITC'
curl 'http://localhost:8787/v1/financials/ITC?statement_type=c&statement_code=pl&period=annual'
curl 'http://localhost:8787/v1/shareholdings/pattern/ITC?period=quarterly'
curl 'http://localhost:8787/enterprise/api/company-profile?symbols=ITC,RELIANCE'
curl 'http://localhost:8787/v1/coverage'
```

## Source and field coverage

Every successful compatibility response has `X-Data-Coverage: partial` and `X-Data-Source: screener`. Missing values are `null`; an unavailable dataset or query variation returns 501 rather than a fabricated successful response. Source HTML is cached for 15 minutes, with bounded storage, concurrent-request coalescing, and an eight-request source concurrency limit. Source request timeout is 15 seconds. There is no guaranteed real-time refresh schedule.

| Resource | Supported behavior and differences |
| --- | --- |
| Stock symbols | Pages of up to 100 source companies, not an unpaginated market-wide master. BSE codes for NSE-path companies are null in the directory; full profiles provide exchange codes when linked by the source. Numeric company paths are treated as BSE identifiers. |
| Profile | Company description, website, exchange links, market cap, and four classification levels from the company page. |
| Stock search | Exact case-insensitive names at all four levels: `macro_sector`, `industry`, `sector`, `sub_industry`. A refreshed snapshot contains 280 classification names/paths. Run `pnpm source:taxonomy` to refresh it; names can change. |
| Statements | `statement_type=s` selects standalone; `c` selects a consolidated company page. `pl` supports annual, quarterly, and source-provided TTM. `bs` and `cf` support annual periods aligned with the P&L table. Half-yearly, YTD, and quarterly BS/CF return 501. Missing consolidated pages return 404 rather than silently using standalone data. |
| Profit & loss | Source sales/revenue, other income, total income, total expenses (operating expenses + interest + depreciation), finance costs, depreciation, PBT, net profit, and EPS. Filing-level sublines, adjusted capital, diluted shares, current/deferred tax, and attribution fields are null. Aggregate mappings are not a filing-level parity claim; banks and insurers need sector-specific adapters. |
| Balance sheet | Equity capital, reserves, total equity, aggregate liabilities (borrowings + other liabilities), total equity and liabilities, total assets, CWIP; expanded schedules add inventories, trade receivables, cash equivalents, trade payables and long/short-term borrowings. Current/noncurrent totals remain null; expanded source sublines do not establish full filing parity. |
| Cash flow | Operating, investing, financing activity totals, and net cash flow. Detailed cash-flow sublines are absent. |
| Ratios | `ratio_type=pr`: available/derived profitability fields. Margins use revenue, except pretax margin uses total income. ROA/ROE use average assets/equity from matching prior-year and current-year balance sheets. ROCE and tax/dividend percentages become fractions. Gross margin and tangible-asset returns are null. `ef`, `le`, `li` return 501 because their reference field mappings are not verified. |
| Financial metrics | `ratio_type=cu`: operating, investing, financing and free cash flow totals over the latest three consecutive annual periods. `gr` and `av` return 501. Missing free cash flow stays null. |
| Basic financials | `statement_code=pl`: EBIT, EBITDA, operating profit/revenue, and tax fraction. COGS, gross income, adjusted capital, historical face value, diluted/share counts, sales per share and operating-expense classifications are null. BS/CF variations return 501. |
| Quote | Delayed summary price, percentage change, market cap, 52-week range. Trade timestamp, volume and shares are null; enterprise OHLC fields are null. Omitting symbols for a market-wide quote feed returns 501. Streaming is unavailable. |
| Peers | Source classification group, page by page; the requested symbol is removed. |
| Shareholding pattern | Aggregate promoters/FIIs/DIIs/government/public rows plus source-disclosed named holders from expanded tables. Percentages retain source units. Missing holder-period values are null; an explicit zero stays zero. `catagory` remains null. Annual uses the source yearly table, quarterly its quarterly table. This is not a complete shareholder register. |
| Ownership current/history | Disclosed holder names, source group and percentage by available reporting period. Current uses the latest quarterly header; histories use annual/quarterly tables. Other statutory fields, share totals, pledges, voting rights and identity data remain null. |
| Ownership summary/distribution | Summary supplies reporting header, total shareholder count and promoter percentage where present. Distribution supplies group percentages. Other statutory fields remain null. |
| Corporate actions | Bonus/split company records retain ratio or old/new face-value text. Rights use the market rights list searched by company name and filtered to the exact symbol; follow pagination. The all-actions route without symbol fetches one page per action type; with symbol it uses the company modal (rights require their dedicated route). Dates use `YYYY-MM-DD`; adjustment factors and exact timestamps are unavailable. |
| Dividends | Company modal supplies dates, rupees per share, type and subject; adjusted amounts remain null. Global dividend lists expose face-value percentages, so their `amount` stays null rather than treating percentages as rupees. |
| Results calendar | Upcoming expected result dates from Market Pulse. Required date-window filters apply to each requested source page. Historical result calendars are not reconstructed. |
| Reports | Annual report URLs grouped by year and exchange. Actual year-end date is null because the source's year label does not prove a closing date. |
| Announcements/ratings/transcripts/presentations | Symbol-filtered document links remain available. Omitting the symbol on announcements now serves the latest market-wide All feed using a source session, including summaries/timestamps where exposed; it has no stable historical cursor. Records without full dates cannot support exact day filters (501). Ratings, transcripts and presentations still require a symbol; gated transcript buttons are not public document URLs. Subcategory/history links remain null. |
| Document dates | Full dates are retained. Day/month labels without a year are interpreted as the nearest past date. Month-only concall dates are null; requests for exact date filtering on them return 501. Unavailable transcript links return 501. |
| IPO calendar | Source IPO listings, subscription totals, price bands and exchange links. Exchange symbol is null when not linked. Status/security type are null; no inference from issue dates. Source labels omit years, so the existing parser uses the current year. Date filters select the subscription start date. |

Directory, search, peer, IPO, upcoming-results, global corporate-action and company-rights responses expose `X-Page` and `X-Next-Page`. Continue until it is empty, even when a date-filtered page has no matching rows. Each global all-actions page merges one source page per requested action; its next cursor continues while any list has more pages. Company split/bonus action modals have no cursor and reject `page>1`. These pagination differences bound source work.

Financial monetary statement amounts are converted from source crores to **rupees** (`1 crore = 10,000,000`). EPS remains rupees per share. Profile/quote market caps retain **crores**, matching the reference examples. Profitability ratios use fractions (`20% = 0.2`); shareholding patterns use percentages (`20% = 20`). Missing values remain distinct from zero. The [field guide](https://www.finedgeapi.com/FinEdge_API_field_reference_guide.pdf) and UI samples disagree on some field spellings (for example `eps` versus `EPS`); the UI sample spelling is used for the P&L compatibility payload.

## Errors and authentication

Errors use `{ "error": "...", "code": "..." }` with optional `endpoint` and `docs`. Compatibility failures return 400 for invalid input, 404 for a missing source resource, 429 for quota exhaustion, 501 for an unsupported dataset/variation, 502 for upstream/authentication/parse failures, and 503 for source capacity or source rate limiting (`SOURCE_RATE_LIMITED`). Error responses are not cached.

The development API limits requests to 60/minute per supplied key or Cloudflare client IP. The limiter is local to a Worker isolate. **Keys are not yet validated against the dashboard database.** Supplying a new arbitrary key changes the quota bucket. Health/OpenAPI remain accessible. See [SaaS limitations](limitations.md) before using this as a paid service.
