# Ledgerline

Free Indian company fundamentals for people and AI agents. No login, API keys, subscriptions, or payments.

This repository contains the Rust data server, a stateless MCP adapter, and the `legerline` CLI. Both clients call the deployed Rust API at `https://stock-market-api.auenkr.com` by default.

The Rust server hosts the [homepage](https://stock-market-api.auenkr.com) and [MCP, CLI, and API documentation](https://stock-market-api.auenkr.com/#api-reference).

## CLI

```sh
npx @auenkr/legerline-cli get_v1_company_search --q reliance
npx @auenkr/legerline-cli get_api_v1_screen --query "Market Capitalization > 500 AND Price to Earning < 15"
```

Use `legerline tools` to list commands and `<command> --help` for parameters. Override the server with `--api-url`, `LEGERLINE_API_URL`, or `legerline set-api-url`.

## MCP

Connect your MCP client to `https://stock-market-mcp.auenkr.com/mcp`, without authentication. Or run a local HTTP adapter:

```sh
npx @auenkr/legerline-mcp --port 8788
```

Use `STOCK_MARKET_API_URL` or `--api-url` to choose another deployed server. The local MCP adapter also calls the deployed API by default.

## Development

Install with `pnpm install`. Run `pnpm dev` inside the `stock-market` tmux session. It starts Rust on port 8787 and MCP on 8788. Set `STOCK_MARKET_API_URL=http://127.0.0.1:8787` when testing MCP against local Rust. See [environment variables](sample.env), [screening](docs/screening.md), and [source limitations](docs/limitations.md).

Run `pnpm test:ci` for Rust tests, MCP and CLI regressions, type checks, and builds. Rust needs no account database; Valkey caching is optional. Source sessions, when required by the upstream provider, are created by logging in with `SOURCE_USERNAME` and `SOURCE_PASSWORD`; the cookie is cached in memory and a temp file and refreshed automatically on expiry.

## Release

Changes go through a PR directly to `main`. CI publishes the CLI and MCP packages to npm, deploys the production MCP Worker, and pushes the Rust Docker image to Docker Hub. The container host is updated manually: pull the new Rust image and restart it. After updating the container, run `node scripts/smoke.mjs https://stock-market-mcp.auenkr.com/mcp https://stock-market-api.auenkr.com` to check anonymous API access. Local `data-scrapping/` data is ignored and must be preserved. No frontend deployment is needed.
