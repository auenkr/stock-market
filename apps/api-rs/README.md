# Rust data server

Free public GET endpoints, without credentials or an account database. Run `cargo run` with `ENVIRONMENT=dev PORT=8787`. Optional Valkey caching and upstream source configuration are listed in [sample.env](../../sample.env). `/health`, `/docs`, `/openapi.json`, and `/v1/coverage` describe the server. Build the container from this directory. Deployment uses the existing Cloudflare Tunnel to the container host.

The homepage contains MCP setup, CLI commands, the screening guide, data limitations, and the searchable API reference. `/docs` redirects to `/#api-reference`.
