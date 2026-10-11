# Ledgerline MCP

Free stateless HTTP MCP, without login or API keys. Connect to `https://stock-market-mcp.auenkr.com/mcp`, or run `npx @auenkr/legerline-mcp`. The local adapter listens at `http://127.0.0.1:8788/mcp` and calls `https://stock-market-api.auenkr.com`. Override with `--api-url` or `STOCK_MARKET_API_URL`. Run `--help` for host and port options. All 14 tools are read-only.
