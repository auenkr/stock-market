# ChatGPT plugin (AI agent API surface)

## Public ChatGPT plugin submission

The current public directory submission uses a plugin ZIP with a remote MCP server. The legacy `ai-plugin.json` and OpenAPI endpoints below do not publish a directory listing.

The draft package lives in `plugins/ledgerline/`. It includes the portable `plugin.json`, a Streamable HTTP `mcp.json`, the existing Ledgerline icon, listing URLs, five positive review cases, and three negative review cases. Build it with `pnpm plugin:package`; the ZIP is written to `dist/ledgerline-chatgpt-plugin-1.0.3.zip`. The archive contains only the two manifests and icon. Local package checks do not replace the portal's automated validation or approval.

### Current submission status (2026-10-04)

Version 1.0.3 is uploaded to the existing [OpenAI plugin draft](https://platform.openai.com/plugins/manage/plugin_asdk_app_6ac1c7d5289c8191b33c7347e9d9cad6) under the Stock Market API organization and verified Individual publisher GOLDEN KUMAR. The listing category is Finance. The portal reports **No Issues** for metadata and **No issues found in the latest MCP scan**, with all thirteen tools discovered and the domain verified. Version 1.0.3 was submitted with the dedicated production reviewer credentials and Google Drive demo. The portal now reports **In review** and **Not published**. Publication remains pending OpenAI approval.

The Cloudflare MCP Worker and Vercel OAuth service are deployed. Production verification covered issuer/resource discovery, PKCE account linking through the browser, token exchange, authenticated MCP GET and POST, thirteen-tool discovery, company search/profile reads, refresh, and the Hobby plan's denial of detailed financial statements. Ten MCP protocol/Worker regression tests and all 36 disposable-database integration tests passed, including account quota and revocation. These runtime checks are separate from the ChatGPT review walkthrough. The five positive and three negative prompts were subsequently run in the signed-in ChatGPT account; a final demonstration displayed fresh calls for search, profile, basic financials, peers, profit/loss, and cash flow. Several ChatGPT answers also used web sources, so the walkthrough is not an isolated API assertion suite.

The production signing-secret mismatch was resolved without rotating Vercel's secret or connection identities: its existing value contains a trailing newline, which Wrangler's stdin secret command trims. The Worker was updated through Cloudflare's API with the exact existing bytes. Both services must retain byte-identical values. No reviewer credentials or service secrets are included in the ZIP. The dedicated reviewer credentials are documented in Git at the owner’s explicit request; service secrets remain excluded.

Before submission:

1. Completed: verified publisher identity, version 1.0.3 upload, public listing URLs, domain verification, OAuth account linking, and issue-free metadata/MCP scans. Continue using the existing draft rather than creating a duplicate listing.
2. Retain the publisher's previously confirmed authorization to distribute the upstream datasets through the plugin. Submission attestations must accurately describe the provider's rights and service.
3. Provide a dedicated reviewer account on the production login flow with Personal or Professional access and sample data, usable without interactive MFA or email-code approval. The development credentials in `AGENTS.md` cannot be used on production. The dedicated account is now provisioned and supplied in the portal; development login remains restricted to dev mode.
4. The [demo recording](https://drive.google.com/file/d/1rZQZGCbvo6OqBDga716lw7vYFFVx-Tx-/view?usp=sharing) is saved in `review.demo_recording_url` and imported into the portal. Anonymous download was verified; the Drive inline player showed a playback error during the browser check. Re-run the five positive and three negative cases with the dedicated reviewer account once it is available. The dedicated reviewer credentials are saved in the portal and the metadata scan reports no issues. The owner authorized ages 13–17 with parent or guardian permission and confirmed third-party data rights and applicable-law compliance. Both policies were deployed and verified before submitting; the portal now reports **In review**.
5. Complete review details and required policy attestations, then submit the draft for review. After OpenAI approves it, select **Publish plugin**. Deployment, uploading the ZIP, and passing scans alone do not publish the listing.

The Terms and Privacy Policy allow ages 13–17 with parent or guardian permission and supervision, exclude children under 13, and require an adult to purchase paid subscriptions. The policy consent version is 2026-10-04.

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

## Reviewer password access

The unlisted `/reviewer/signin` route accepts verified, administrator-provisioned credential accounts in production. Public sign-in remains Google-only and password signup is disabled. See [reviewer access](reviewer-access.md) for the dedicated account and the administrator provisioning command. The reviewer’s production Professional subscription was activated through Polar with coupon `REVIEWER` at ₹0. The same login exists in both databases; billing belongs to production.

Terms and Privacy Policy permit ages 13–17 with parent or guardian permission and supervision. Children under 13 are excluded; an adult must purchase paid subscriptions.
