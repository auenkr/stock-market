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

The competitor table below is earlier research, not newly verified market quotes. See the [2026-10-03 go-to-market research](go-to-market.md) for primary-source comparisons, including Finmagine's separate API plans and ChatGPT connection.

### Approved launch plans (2026-10-03)

| Plan | Monthly base price | Requests/minute/account | Agent access |
| --- | ---: | ---: | --- |
| Hobby (`free`) | ₹0, no credit card | 10 | Discovery and free company tools for the five-company allowlist |
| Basic (`basic`) | ₹199 | 60 | Discovery and free company tools for all supported companies |
| Personal (`personal`) | ₹399 | 300 | All public agent tools and supported companies; non-commercial |
| Professional (`professional`) | ₹2,499 | 500 | Personal plus commercial use |

REST, ChatGPT agent tools, MCP, and CLI share the same key, account, billing, and quota. No separate plugin charge. The manifest describes the plans and upgrade paths; `/plugin/openapi.json` includes `x-access-policy` and the same plan descriptions as the public contract. `PAID_PLAN_REQUIRED` means Personal or Professional is required, even when the user pays for Basic. `FREE_COMPANY_RESTRICTED` means upgrade Hobby to Basic or higher. Missing source data remains unavailable on every plan.

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

The earlier three-tier pricing decision is superseded by the approved four-tier launch plans above. Billing remains with Polar. Review pricing using paid activation, repeat usage, renewals, and observed delivery costs.

## Tests

`apps/api/tests/integration/plugin.test.ts` runs inside `pnpm --filter @stock-market/api test:integration` (disposable PostgreSQL + fixture source). It validates the manifest shape, API-key auth wiring, internal-endpoint exclusion, agreement between `/plugin/openapi.json` and the shared `agent-tools` contract, end-to-end execution of every plugin tool against the fixture source, and no source-attribution leakage.
