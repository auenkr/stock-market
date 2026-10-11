# Data limitations

## API scope

Removed datasets have no routes or placeholder contracts. Five remaining market-history paths are excluded: daily/annual price ratios, historical index prices/valuations, and commodity price trends. Financial statements, ownership data, and corporate events remain in scope. Internal endpoints are documented only with `ENVIRONMENT=dev`.

## Remaining gaps within working adapters

- Named current/historical holders, ownership summary/distribution, corporate actions, dividends and upcoming results now have partial Screener adapters. These are no longer wholly unavailable datasets. Ownership share counts, voting rights, pledges, warrants and other statutory fields remain null.
- Company dividend amounts are rupees per share; global dividend lists expose percentages of face value, so global amounts stay null. Adjusted historical dividends, complete action archives and exact publication timestamps remain unavailable. Company-specific rights history uses a searched, paginated market list with exact-symbol filtering.
- Balance-sheet schedules now expose inventories, receivables, cash, payables and long/short-term borrowing fields. Complete filing sublines, current/noncurrent totals and bank/insurance adapters remain incomplete.
- Upcoming results are a paginated future calendar. Historical result calendars are not supplied. Company announcements are part of grouped documents; exact dates may be missing.
- Finance exposes dedicated quarterly/annual P&L, balance sheet, cash flow, ratios, peer comparison, quarterly shareholding pattern and distribution with only a URL-valued `symbol`.

## Source constraints observed through 2026-10-01

- Screener company pages, industry directory, peer classification pages and IPO pages were reachable. The company master screen redirects unauthenticated requests to login; it worked using the existing local source session.
- A direct NSE quote request returned HTTP 403. No NSE adapter is presented as validated. An archive request also failed in this environment.
- Some transcript links are unavailable for the source session, while presentation links are exposed. Source HTML markup, login requirements, available periods and link visibility can change.
- The supplied temporary free account was used to sign in through the shared browser. Company actions, named holder expansions, upcoming results and Market Pulse action lists were accessible. Segment values and commodity tools remain premium-gated.
- Source 429 is exposed as 503 `SOURCE_RATE_LIMITED`, not an empty successful dataset. Company classification metadata remains available in profiles; classification search and its taxonomy refresh tooling have been removed.
- Statement values are rounded source aggregates. Detailed filing sublines and sector-specific bank/insurance schemas are not established by the new snapshot parser. Nulls and shorter field sets are explicit compatibility differences.
- Company requests accept one URL-valued `symbol`; tickers and batches are rejected. On-demand scraping, local caches and source credentials cannot support unrestricted all-market bulk requests or reliable streaming.
