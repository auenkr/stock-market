# stock-market-mcp

Stateless HTTP MCP server for the Ledgerline Stock Market API.

## Run

```bash
npx stock-market-mcp --port 8788 --api-url https://stock-market-api.auenkr.com
```

Options: `--port`, `--host`, `--api-url`, `--help` (env: `MCP_PORT`, `MCP_HOST`, `STOCK_MARKET_API_URL`).

## Auth

Send your dashboard API key on every request via `Authorization: Bearer <key>` or `X-API-Key: <key>`. The same key is forwarded to the Stock Market API.

## Endpoint

`POST /mcp` (MCP Streamable HTTP, stateless), `GET /health`.

## Hosted

`https://stock-market-mcp.auenkr.com/mcp`

## Tools

Search (`search_companies`, `list_companies`), Company overview (`company_profile`, `basic_financials`, `company_documents`), Finance (`peer_comparison`, `quarterly_profit_loss`, `profit_loss`, `balance_sheet`, `cash_flow`, `ratios`, `shareholding_pattern`, `shareholding_distribution`).
