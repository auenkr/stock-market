# legerline-mcp

Stateless HTTP MCP server for the Ledgerline Stock Market API.

## Run

```bash
npx legerline-mcp --port 8788 --api-url https://stock-market-api.auenkr.com
```

Options: `--port`, `--host`, `--api-url`, `--help` (env: `MCP_PORT`, `MCP_HOST`, `STOCK_MARKET_API_URL`).

## Auth

The npm/Node server accepts your dashboard API key on every request via `Authorization: Bearer <key>` or `X-API-Key: <key>`. The same key is forwarded to the Stock Market API.

The Cloudflare Worker also accepts OAuth 2.1 bearer tokens issued by Ledgerline’s Better Auth server. ChatGPT users sign in with Google and approve `market:read` access. Tokens are bound to the MCP resource; the private account adapter resolves a dedicated revocable dashboard key, so billing and request allowances remain shared across REST and MCP. API keys remain supported for existing clients.

## Endpoint

`POST /mcp` (MCP Streamable HTTP, stateless), `GET /health`. The Worker also serves `GET /.well-known/oauth-protected-resource` (and `/mcp` suffix) and a configured OpenAI domain challenge.

## Hosted

`https://stock-market-mcp.auenkr.com/mcp`

## ChatGPT public directory

OAuth support is implemented in the Worker and web account service. It must be migrated, configured and deployed before enabling OAuth in the directory draft. A draft public plugin package is available at `plugins/ledgerline/` in the repository. Run `pnpm plugin:package` from the repository root to create its ZIP. See [submission status and prerequisites](../../docs/plugin.md#public-chatgpt-plugin-submission). Version 1.0.0 is uploaded as an OpenAI plugin draft; it has not been submitted for review or published.

## OAuth deployment

1. Apply `pnpm db:migrate:mcp-oauth` to the account database before deploying the web app. The repeatable migration adds Better Auth JWT/OAuth tables and the `MCP_RESOURCE_URL` policy.
2. Set the same separate, random `MCP_ACCOUNT_SERVICE_SECRET` (at least 32 characters) on Next.js and the MCP Worker. Store the Worker value with `wrangler secret put MCP_ACCOUNT_SERVICE_SECRET`; do not put it in a manifest or Wrangler vars. Keep this secret stable to preserve connection key identities.
3. Set `MCP_RESOURCE_URL` to the exact HTTPS `/mcp` URL on both services and `MCP_AUTHORIZATION_SERVER` to the web app’s Better Auth issuer, normally `https://stock-market.auenkr.com/api/auth`. The issuer must match `BETTER_AUTH_URL` plus `/api/auth`. Configure Google OAuth as for ordinary Ledgerline sign-in.
4. Deploy Next.js and the Worker, then check issuer discovery at `/api/auth/.well-known/oauth-authorization-server` and `/.well-known/oauth-authorization-server/api/auth`. An unauthenticated MCP POST should return 401 with the protected-resource metadata challenge.
5. Select OAuth with dynamic client registration in the OpenAI draft. Request `market:read` and `offline_access`; use the discovery metadata’s authorization, token and registration URLs. Run account linking before scanning tools.

The resource is available to registered public OAuth clients after explicit user consent. Machine grants and administrative client mutations are disabled. The account adapter accepts only signed server-to-server requests, verifies tokens through Better Auth, checks the resource, scope, active account and consent, and refuses revoked/expired connection keys. JWT access tokens expire after five minutes. Revoking the dashboard connection key or deleting consent takes effect on the next MCP request.

## Tools

Search (`search_companies`, `list_companies`), Company overview (`company_profile`, `basic_financials`, `company_documents`), Finance (`peer_comparison`, `quarterly_profit_loss`, `profit_loss`, `balance_sheet`, `cash_flow`, `ratios`, `shareholding_pattern`, `shareholding_distribution`).
