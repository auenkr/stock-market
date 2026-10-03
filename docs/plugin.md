# ChatGPT plugin (AI agent API surface)

The API ships a first-class agent surface at the same base URL:

- `GET /.well-known/ai-plugin.json` — plugin manifest. `auth` is the same dashboard API key: `X-API-Key: sm_live_...` (also accepted as `Authorization: Bearer`).
- `GET /plugin/openapi.json` — OpenAPI 3.0.3 document restricted to the public agent tools. Internal endpoints (`/v1/company-data`, `/v1/extract`, `/v1/list-of-ipo`, `/v1/coverage`, corporate actions, results calendar, ownership datasets), service endpoints, and market-history routes are never exposed.

Tool contract is derived from the same API catalog that powers `/openapi.json`, so names, parameter notes, and coverage stay in sync. Discover first, then quote:

1. `get_v1_company_search` (or `get_v1_list_of_company`) → `symbol`
2. Pass `symbol` unchanged to company endpoints: `get_v1_company_profile`, `get_v1_basic_financials`, `get_v1_company_documents`, `get_v1_peer_comparison`, `get_v1_quarterly_profit_loss`, `get_v1_profit_loss`, `get_v1_balance_sheet`, `get_v1_cash_flow`, `get_v1_ratios`, `get_v1_shareholding_pattern`, `get_v1_shareholdings_distribution`

Personal resource operations are exposed at their canonical `/api/v1/...` paths in the manifest; `/v1/...` aliases continue to work.

## Shared agent contract

`packages/agent-tools` (`@stock-market/agent-tools`) is the single source for the agent tool list: `agentTools(spec)`, `agentOpenApi(spec, info)`, and `agentPluginManifest(origin, tools)`. The untracked-but-shipping `apps/legerline-cli` and `apps/mcp` both consume this package/derived contract, so the ChatGPT plugin, MCP server, and CLI expose the same tools, parameters, and API key auth. Do not add internal-API commands to any of them.

## Competitor research and pricing decision

Competing finance data providers (research, October 2026):

| Provider | Entry | Mid | Notes |
| --- | --- | --- | --- |
| FMP | ~$0–22/mo | $59–149/mo | US/global fundamentals; 300–3,000 calls/min |
| Marketstack | $0/mo (100 req) | $9.99–49.99/mo | EOD snapshots, intraday on paid |
| TrueData (India) | ₹1,440/mo | ₹1,950–2,600/mo | Real-time NSE/BSE/MCX, approval required for API |
| Zerodha Kite Connect | ₹0 personal | ₹500/mo Connect | Trading APIs; execution/free data for personal |
| BSE/NSE official | — | enterprise | ₹1L+/yr redistribution |
| Brokers (Fyers, Upstox, Shoonya) | free | — | Trading-focused, not fundamentals |
| Fincrux | ₹0 (5 calls/day) | ₹200/mo | Statements, FII/DII |
| SensiBook | ₹1/credit | 5–25 credits/call | Company registry + financials |
| Finmagine | free | api_pro tier | NSE fundamentals; MCP |
| HSH Intelligence | pay €/call (x402/USDC) | — | NSE XBRL, MCP |

BharatStock and Stoxim target the same niche but publish limits-not-plans (free incl. all endpoints, history depth gates); TrueData's API requires separate approval on top of ₹1,440/mo plans.

Decision: keep the existing tiers and make the ChatGPT plugin a zero-surcharge distribution channel for the same account and API key — Basic (₹0, 10 req/min, five free companies), Personal (₹2,000/mo, 300 req/min), Professional (₹5,000/mo, 500 req/min, commercial use). Rationale: it sits ≈ FMP's paid entry when converted, below TrueData/BSE for data-only needs, and clearly above free broker APIs on fundamentals coverage (statements, ratios, shareholding, documents, peers). Billing/plan handling stays with Polar; the plugin adds no separate Stripe/SKU line. Revisit pricing after ~1,000 agent-driven accounts or when MCP/CLI attach.

## Tests

`apps/api/tests/integration/plugin.test.ts` runs inside `pnpm --filter @stock-market/api test:integration` (disposable PostgreSQL + fixture source). It validates the manifest shape, API-key auth wiring, internal-endpoint exclusion, agreement between `/plugin/openapi.json` and the shared `agent-tools` contract, end-to-end execution of every plugin tool against the fixture source, and no source-attribution leakage.
