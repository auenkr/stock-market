# API compatibility

Endpoint paths, arguments, schemas, tiers, and categories are defined by the API catalog. [Endpoint coverage](endpoint-coverage.md) and [endpoint journey](endpoint-journey.md) are generated from the same contract as Swagger.

## Categories and company identifiers

Public documentation has **Search**, **Company overview**, and **Finance**. **Internal** is shown only when `ENVIRONMENT=dev`, in both API/web viewers and downloadable OpenAPI. Its routes keep their normal access rules. The repository's generated contract includes Internal for development; served contracts filter it out in other environments.

Company-name search (`/v1/company-search?q=reliance`, also `/api/company-search`) returns `{data, results}` containing the same results. Each result has `name` and `symbol`. `symbol` contains the original company URL path, replacing the former `url` field. No exchange ticker is extracted:

```json
{"name":"Reliance Industries", "symbol":"/company/RELIANCE/consolidated/"}
```

All Company overview and Finance endpoints accept **one required query parameter: `symbol`**. Pass the search value unchanged using `URLSearchParams` or `curl --data-urlencode`. Relative company paths, including numeric IDs, are accepted; absolute URLs, traversal, non-company paths, arrays, and repeated symbols are rejected. The URL itself selects standalone or consolidated data. No `statement_type`, `statement_code`, `period`, `ratio_type`, `group`, or `page` filters are accepted in these categories.

```bash
curl --get 'http://localhost:8787/v1/company-profile' --data-urlencode 'symbol=/company/RELIANCE/consolidated/'
curl --get 'http://localhost:8787/v1/profit-loss' --data-urlencode 'symbol=/company/RELIANCE/consolidated/'
curl --get 'http://localhost:8787/v1/company-documents' --data-urlencode 'symbol=/company/RELIANCE/consolidated/'
```

Personal endpoints support `/api/v1/...` and `/v1/...` aliases with the same schemas and access rules.

Company listing is also in **Search** (`/v1/list-of-company`, also `/api/list-of-company`). It returns `{meta, data}` with original company URL paths in `symbol`, not `url`; `skip` is omitted. Pagination is in `meta`: `currentPage`, `limit`, `count`, `isNextPageAvailable`, `nextPage`, and `previousPage`.

## Company overview

| Endpoint | Response |
| --- | --- |
| `company-profile` | Company name, description, website, exchange identifiers, classification, and market capitalization. |
| `basic-financials` (Basic finance) | `{symbol, summary, about, keyPoints, basicFinance, analysis}`. `basicFinance` contains current price, change, market cap, and 52-week range; unavailable share counts, trade time, and volume are null. `analysis` contains `pros` and `cons`. Historical annual metrics are in Finance. |
| `company-documents` | `{symbol, documents}` grouped into `annualReports`, `announcements`, `creditRatings`, `callTranscripts`, `presentations`, and `other`. Each document has `title`, `url`, `date`, and `year`. Missing groups are empty arrays; unknown exact dates are null. |

## Finance

| Endpoint | Response |
| --- | --- |
| `peer-comparison` | `{symbol, peers}` with URL-valued company identifiers, names, current price, P/E, market capitalization, dividend yield, quarterly sales/profit and growth, and ROCE. |
| `quarterly-profit-loss` | `{symbol, financials}` with quarterly results, including EBIT/EBITDA, operating profit/revenue, tax fraction, and EPS where available. |
| `profit-loss` | `{symbol, financials}` with annual results and available TTM rows, including the historical metrics previously exposed separately by Basic financials. |
| `balance-sheet` | `{symbol, financials}` with balance sheets and available expanded schedules for inventories, receivables, cash equivalents, payables, and borrowings. |
| `cash-flow` | `{symbol, financials}` with operating, investing, financing, net, and available free cash flow. |
| `ratios` | `{symbol, ratios, metrics}` with derived profitability ratios and the reported ratio table as period/value pairs. |
| `shareholding-pattern` | Quarterly category/holder percentages using `columns` and `rows`. Missing holder-period values are null; explicit zero remains zero. `catagory` retains its original spelling. This is not a complete shareholder register. |
| `shareholdings/distribution` | Quarterly ownership-category percentages grouped by reporting period. Accepts only `symbol`. Statutory counts, voting rights and share totals may be null. |

Financial statement monetary amounts are **INR rupees** (`1 crore = 10,000,000`); EPS is rupees per share. Overview and peer comparison market caps retain **INR crores**. Peer quarterly sales/profit are crores; price is rupees per share. Derived profitability ratios are fractions (`20% = 0.2`); peer comparison, summary, and shareholding percentages are percentage points (`20% = 20`). Reported ratio-table values retain their labels and source units. Missing values remain distinct from zero. Summaries and prices may be rounded or delayed.

## Internal

Upcoming IPOs, results calendar, corporate actions/dividends, extra ownership datasets, full-company/extract, health, and coverage are grouped under Internal. Company-scoped operations use the same URL-valued `symbol`; reporting period, action, pagination and date filters remain available where documented. IPO calendar, holiday calendar and the removed placeholder datasets have no routes, schemas or docs operations.

Full company data (`/v1/company-data`, also `/api/company-data`) requires `symbol`, taken unchanged from search/listing. Extraction (`/v1/extract`, also `/api/extract`) requires `symbol` and `type`. The obsolete `companyUrl` and `endpoint` query names are rejected. Full data returns `{data, companyData}` containing `symbol` and the company's `website`; extraction returns `{data, meta: {symbol, type, cached}}`. Peer rows also expose their company paths as `symbol`. They share a 15-minute cache and return `X-Cache: HIT` on reuse. Legacy numbers retain `{amount, baseValue}` and spellings such as `reservers` and `fiexedAssets`; blank/unparseable cells may become zero. Their public `metrics` array remains empty; market history is excluded. Optional news/GMP failures preserve the main response.

Company corporate actions use `/v1/corporate-actions?symbol=/company/RELIANCE/`. Optional `action=split|bonus|rights|dividend` selects a type; omitting it returns all actions in a stable `{symbol, actions}` envelope. Company modal records appear on page 1; rights come from a company-filtered paginated list. Later pages return only rights. A specific non-rights filter rejects `page>1`. Market corporate actions (`corporate-actions/all`) use the same optional filter and optional URL-valued symbol. Current/history ownership retains `period` where applicable. Results/action lists expose `X-Page` and `X-Next-Page`; date filters use `YYYY-MM-DD` and apply to the requested source page.

Market-history routes remain excluded. Source responses are cached for 15 minutes with bounded storage and concurrent-request coalescing. Individual upstream requests have a 15-second timeout.

### Calendar and IPO data sources

- **Results calendar:** Screener's `/upcoming-results/`, using the configured source session. These are expected upcoming result dates, not a reconstructed historical calendar.
- **Upcoming IPOs (`list-of-ipo`):** Screener's `/ipo` listing and linked listing pages through the legacy parser. Optional GMP enrichment uses InvestorGain's `https://webnodejs.investorgain.com/cloud/v2/index/gmp-data`; enrichment failure leaves GMP null. This parser returns complete records only, not every partially populated listing.
- **IPO calendar:** removed; it previously used the same IPO page with per-page/date-filtered mapping.
- **Holiday calendar:** removed; it never had a connected holiday source and returned 501.

## Endpoint tiers

Free endpoints include company search/listing, profiles, basic finance, peer comparison, and Internal upcoming-IPO/results/service operations. Documents, detailed statements, ratios, shareholding, and other paid Internal datasets require Personal or Professional.

Basic company access is limited to **RELIANCE, HDFCBANK, BHARTIARTL, ICICIBANK, and SBIN**, the versioned top-five market-cap allowlist at the 2026-10-01 close. Other company URLs require paid access. Numeric-ID company URLs currently require paid access because they cannot be matched to the allowlist before loading data. Aliases inherit their canonical tier.

## Errors and authentication

Send a dashboard-issued key through `X-API-Key` or Bearer authorization. Expired, revoked, and invalid keys return 401. Basic cannot call paid endpoints (`403 PAID_PLAN_REQUIRED`) or other companies on free company endpoints (`403 FREE_COMPANY_RESTRICTED`). Personal and Professional unlock both endpoint tiers and all supported companies; only Professional permits commercial use. Verified monthly subscription updates control paid access.

Allowances are **10 requests/minute for Basic, 300 for Personal, and 500 for Professional**, shared across all keys and API instances. Rejected authenticated requests consume the allowance. Exhausted accounts receive 429 with `Retry-After`. Health and OpenAPI are public and unmetered. Apply `pnpm db:migrate:billing` after the API-plan/account-usage migrations; see [billing setup](polar-setup.md).

Errors use `{error, code}` with optional `endpoint` and `docs`. Invalid/missing/unknown parameters return 400; missing resources 404; unavailable datasets 501; upstream/authentication/parse failures 502; source capacity/rate limits 503. Error responses are not cached. Every response includes `X-Request-ID`; successful resource responses include `X-Data-Coverage: partial`. Provider attribution fields and `X-Data-Source` are not returned. Required company identifiers and real company/document links remain usable.

OpenAPI tags, `x-use-case`, and `x-order` describe the four categories; `x-tier` remains independent of category. `/v1/coverage` publishes the same classifications without provider attribution.
