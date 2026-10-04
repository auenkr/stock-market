# ChatGPT plugin (AI agent API surface)

## Public ChatGPT plugin submission

The current public directory submission uses a plugin ZIP with a remote MCP server. The legacy `ai-plugin.json` and OpenAPI endpoints below do not publish a directory listing.

The draft package lives in `plugins/ledgerline/`. It includes the portable `plugin.json`, a Streamable HTTP `mcp.json`, the existing Ledgerline icon, listing URLs, five positive review cases, and three negative review cases. Build it with `pnpm plugin:package`; the ZIP is written to `dist/ledgerline-chatgpt-plugin-1.0.0.zip`. The archive contains only the two manifests and icon. Local package checks do not replace the portal's automated validation or approval.

### Current submission status (2026-10-04)

Uploaded as version 1.0.0 Draft in the Stock Market API organization and project under the verified Individual identity GOLDEN KUMAR. [Open the plugin draft](https://platform.openai.com/plugins/manage/plugin_asdk_app_6ac1c7d5289c8191b33c7347e9d9cad6). The portal reports Not published, Configuration incomplete, and Not submitted. Live checks confirmed `/health` returns 200, unauthenticated `POST /mcp` returns 401 without an OAuth discovery challenge, and `/.well-known/oauth-protected-resource` returns 404. The four public listing URLs respond with HTTP 200. The current dashboard API-key transport is not the OAuth 2.1 account-linking flow required for authenticated ChatGPT MCP connections.

The initial identity-verification block was resolved after the publisher completed Individual verification. The ZIP upload succeeded and the listing metadata and review cases were imported. The MCP connection remains unconfigured: the package currently imports as No Auth, while the hosted server requires a dashboard API key. Do not attempt to bypass this mismatch by sharing a fixed API key in package headers. The publisher confirmed permission to resell the structured upstream company data in this session. Local OAuth integration and browser walkthroughs now cover sign-in, consent, PKCE, refresh, quotas and revocation; the source implementation is ready for deployment. The five focused MCP tests, MCP typecheck, Worker build, and local ZIP checks passed; the proposed ChatGPT review cases have not been run.

Before submission:

1. Completed: verified Individual publisher GOLDEN KUMAR, selected Stock Market API organization and project, and uploaded the ZIP at [OpenAI Plugins](https://platform.openai.com/plugins). Preserve that identity when updating the existing draft.
2. Retain the publisher's confirmed authorization to distribute the upstream datasets through the plugin. OpenAI requires authorized third-party access and does not approve unofficial pass-through connectors; submission attestations must accurately describe the provider's rights and service.
3. Implemented locally using Better Auth OAuth Provider + JWT: account linking, a signed consent screen, dynamic registration, refresh, resource-bound tokens, discovery and a private account-key adapter. Apply `pnpm db:migrate:mcp-oauth`, configure the shared `MCP_ACCOUNT_SERVICE_SECRET`, and deploy the web app and Worker as described in [MCP OAuth deployment](../apps/mcp/README.md#oauth-deployment). Then enable OAuth in the draft and verify PKCE S256, resource binding, discovery, and token validation against the deployed services. Preserve per-account billing, expiration, revocation, and shared quota enforcement. Do not put a shared API key in the ZIP or ask users to paste credentials into chat.
4. Deploy the MCP tool annotations and server guidance, then test the connection in ChatGPT developer mode. The tools advertise `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: true`: they read public company data and do not execute trades, payments, or account mutations. Read requests still consume the account's allowance.
5. Provide a dedicated reviewer account on the production login flow with Personal or Professional access and sample data, usable without interactive MFA or email-code approval. The local development credentials in `AGENTS.md` are for local testing; do not enable development login globally in production. Enter reviewer access only in the secure portal form.
6. Run all five positive and three negative review cases through ChatGPT with that reviewer account. The packaged cases are proposed expectations, not recorded successful runs. Record the walkthrough and supply a reviewer-accessible video URL in `review.demo_recording_url` or the portal.
7. Upload the ZIP, obtain the exact domain-verification token, and serve it as plain text at the portal-specified `/.well-known/openai-apps-challenge` URL. Connect the MCP server, scan its tools, resolve required findings, and complete review details.
8. Submit the draft for review. After OpenAI approves the package, select Publish plugin. Repository changes, a successful Worker deployment, and uploading the ZIP alone do not publish the listing.

The current privacy policy states that Ledgerline is intended for adults. Confirm the intended audience and reconcile any eligibility wording with the general-audience directory guidelines before submission; do not silently change product eligibility or attestations.

Source requirements: [Package your plugin](https://developers.openai.com/plugins/build/plugins), [Authentication](https://developers.openai.com/plugins/build/auth), [Submit and publish](https://developers.openai.com/plugins/deploy/submission), and [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines).

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

REST, ChatGPT agent tools, MCP, and CLI share account billing and quota. OAuth MCP connections receive a dedicated revocable account key internally; direct clients continue to use dashboard keys. No separate plugin charge. The manifest describes the plans and upgrade paths; `/plugin/openapi.json` includes `x-access-policy` and the same plan descriptions as the public contract. `PAID_PLAN_REQUIRED` means Personal or Professional is required, even when the user pays for Basic. `FREE_COMPANY_RESTRICTED` means upgrade Hobby to Basic or higher. Missing source data remains unavailable on every plan.

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
