# Screener exploration — 2026-10-01

Used the shared computer-use browser to explore public pages, then signed in with the supplied temporary free account. The existing local source session was used for reproducible adapter checks. Credentials and cookies are not stored in this document, fixtures, Swagger or the docs UI.

## Data found and connected

| UI location / observed source path | Finding | API use |
| --- | --- | --- |
| [ITC company page](https://www.screener.in/company/ITC/consolidated/), expandable balance-sheet rows | Other Assets exposes inventories, receivables and cash; Borrowings exposes long/short-term debt; Other Liabilities exposes trade payables. Observed `/api/company/1552/schedules/` with parent/section and `consolidated=true`. | Annual BS gains these source fields, converted from crores to rupees. |
| Company Investors → FIIs/DIIs/Government/Public/Promoters expansions | Named holders and period percentages; missing periods are absent, not zero. Observed `/api/3/1552/investors/foreign_institutions/quarterly/` and yearly variants. | Pattern now includes names; current/history ownership, summary and distribution have partial adapters. |
| Company Balance Sheet → Corporate actions | An anonymous browser is redirected to registration. After login, its observed XHR `/company/actions/1552/` returned dividend, bonus, split and merger panels. ITC had 30 dividends, 3 bonuses and 1 split in this inspection. XHR requires `X-Requested-With: XMLHttpRequest`; a plain navigation can redirect to the company page. | Company dividend/bonus/split and filtered all-actions resources. Adjusted amounts stay null. |
| [Market Pulse](https://www.screener.in/filings/) → Upcoming Results | Sign-in is required. Browser displayed expected dates (for example 1 October 2026), distinct from financial reporting headers. Observed `/upcoming-results/`, `#result_list`, and source paginator `p`. | Results calendar with date-window filtering and API `page`/`X-Next-Page`. |
| Market Pulse → Bonus / Right / Split / Dividend | Action lists expose ex-dates and ratios; dividends expose percentages of face value. Source paths `/actions/bonus/`, `/actions/right/`, `/actions/split/`, `/actions/dividend/`. | Paginated global action feed; company rights query filtered to the exact symbol. Global dividend amounts remain null because percentages are not rupees per share. |
| Company Documents | Annual reports, announcements, ratings, and concall links are available on the company page. | Grouped company-documents response; unavailable link groups are empty. |

## Missing or blocked data

| Dataset / inspected location | Evidence and remaining requirement |
| --- | --- |
| Segment revenue, company Product Segments | The observed `/api/segments/1552/profit-loss/1/?consolidated=true` returned segment labels but “Please upgrade to premium for segment results.” after sign-in. Numeric values are not available with this account. Keep 501; no purchase or gate bypass performed. |
| Statutory notes | Financial schedules expose selected breakdowns. They do not provide full structured notes or establish filing-level parity. Need independent filing extraction. |
| Full ownership declarations / beneficial owners | Investors expansions expose selected names/percentages, not declaration flags, voting/control rights, beneficial acquisition dates, pledges or other statutory records. Need structured filings. |
| Transcript links, company Documents → Concalls | ITC had public PPT links but no public Transcript anchors with the free account. Gated buttons cannot be returned as downloadable PDFs; the grouped response returns an empty transcript list when no links are available. |
| [Nifty 50](https://www.screener.in/company/NIFTY/), index membership links in company Peers | Individual index cards and paginated constituents are visible. No verified complete index master/feed, reference identifier mapping, full OHLC/turnover or all requested simple-return windows were connected. Selected CAGR values do not establish simple returns with exact dates. |
| [Commodity tool](https://www.screener.in/hs/) | Signed-in navigation redirected to premium. The tool's product identifiers also differ from reference `monthly_index`/`core_infra` statistical categories. Need the proper statistical dataset and code mapping. |
| Exchange holiday calendar | No authoritative holiday list was found among the inspected Tools/Market Pulse pages. Upcoming results is a separate dataset and cannot substitute for it. |
| Name/symbol changes | Current profiles and equity history do not expose a structured old/new name/ticker event feed with effective dates. Need exchange event records. |
| Enterprise refreshed stocks | A scrape time or HTTP response cannot identify dataset revisions. Need persisted ingestion/version logs. |

## Source and validation limits

The API reports source throttling as 503 `SOURCE_RATE_LIMITED`. The live expansion probe spaces source requests and checks non-empty mapped records without storing raw source pages.

Working resources are partial, including source-disclosed holders and rounded financial schedules. They do not establish a complete statutory register, a complete historical archive, commercial data rights, production source capacity, or market-price history coverage. The [coverage matrix](endpoint-coverage.md) and operation descriptions in [Swagger](../swagger.json) record the supported subset.
