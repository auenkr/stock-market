# Rust data server

Free public GET endpoints, without credentials or an account database. Run `cargo run` with `ENVIRONMENT=dev PORT=8787`. Optional Valkey caching and upstream source configuration are listed in [sample.env](../../sample.env). `/health`, `/docs`, `/openapi.json`, and `/v1/coverage` describe the server. Build the container from this directory. Deployment uses the existing Cloudflare Tunnel to the container host.

The homepage contains MCP setup, CLI commands, the screening guide, and the searchable API reference. `/docs` redirects to `/#api-reference`.

The Rust server also hosts `/privacy-policy`, `/terms-of-service`, and `/support`. Support links to the repository’s GitHub issues.

## IPO endpoints

`GET /v1/ipos?type=mainboard|sme[&page=n]` lists IPOs (id, dates, price band, lot size, issue size, GMP, subscription). Pass an `id` to `/v1/ipo`, `/v1/ipo-gmp`, `/v1/ipo-subscription` or `/v1/ipo-review` for the per-IPO sections. Pages are scraped from `IPO_SOURCE_BASE_URL` (default ipoguru.in), parsed once, and reused from Valkey (or an in-process cache when Valkey is not configured). Listings are cached for 10 minutes, GMP and subscription for 5, detail and review for 30. These endpoints appear in the public "IPO" API reference section in every environment. Dates are ISO 8601 timestamps with explicit timezone offsets; date-only source values use midnight India time (+05:30). Metric comparisons use named keys such as `eps.preIssue` and `eps.postIssue`. Responses omit source URLs, `source`, `statusLabel`, and `fetchedAt`.
