# Hosted development environment

## Services

| Service | Development | Production |
| --- | --- | --- |
| Web / auth / billing | https://stock-market-web-dev.vercel.app | https://stock-market.auenkr.com |
| REST API | https://stock-market-api-dev.auenkr.com (Rust) | https://stock-market-api.auenkr.com (Rust) |
| MCP | https://stock-market-mcp-dev.auenkr.com/mcp | https://stock-market-mcp.auenkr.com/mcp |

The Rust REST API runs as a container on the existing API host and is exposed
through that machine's Cloudflare Tunnel. Wrangler must not attach the API
hostname to a Worker. The hosted MCP remains a Cloudflare Worker
(`stock-market-mcp-dev`).
The web has its own Vercel project, **stock-market-web-dev**, with root directory
`apps/web` and Node.js 24. Its stable Vercel domain is used for auth and callbacks.
GitHub Actions deploys this project explicitly; it is not connected to automatic
Git deployments, so it cannot deploy before validation finishes.

The app setting is **`ENVIRONMENT=dev`**, case-sensitive. `DEV` is not a valid
value. This enables development password login and internal API documentation,
and selects Polar **sandbox**. Vercel's `--prod` flag means the stable deployment
of the *dev project*: `NODE_ENV=production` / `VERCEL_ENV=production` do not select
live billing. Billing uses the separate application setting `ENVIRONMENT`.

The scraping orchestrator and polling worker are local Node.js jobs, started with
the existing `pnpm dev` command in the `stock-market` tmux session. The scraping
CLI is on-demand. The hosted API fetches data directly and does not depend on
these local jobs. CLI clients can target the dev API with their API URL option.

## Branch and deployment flow

```text
feature branch → pull request into dev → Tests + Build → merge
  → full CI again on the dev commit
  → deploy dev web and MCP → smoke-check the tunnel-hosted Rust API and MCP
  → successful GitHub development deployment
  → pull request dev → main → CI + Dev promotion + existing Vercel checks
  → merge → existing production deployment workflow
```

- `dev` was created from `main`. It requires pull requests, passing `Tests` and
  `Build`, an up-to-date branch, and resolved review threads. Force pushes and
  branch deletion are blocked.
- `.github/workflows/deploy-dev.yml` runs only on `dev`. It calls the same CI
  workflow used for PRs, including integration, browser, MCP, performance and
  workspace build checks. Failed validation prevents deployment.
- The GitHub `development` environment only accepts the `dev` branch.
- `main` retains its existing protections and additionally requires the
  `Dev promotion` check. This verifies that the PR is from this repository's
  `dev` branch and its exact head SHA has a successful `development` deployment.
  If a promotion PR is opened before deployment finishes, re-run its failed
  `Dev promotion` check after `Deploy development` succeeds.
- Dev deployments are serialized. A failed/partial rollout has a failed
  deployment status and cannot qualify for promotion. Fix the issue and rerun
  the workflow on `dev`; multi-provider deployment is not atomic.
- The bootstrap setup PR targets `dev`. Automation becomes active when that PR
  merges. The initial CLI deployment is not a substitute for a successful
  CI-managed deployment of the commit being promoted.

## GitHub configuration

Repository secrets already used by production:

- `CLOUDFLARE_API_TOKEN` (Workers scripts and routes/custom-domain permissions)
- `CLOUDFLARE_ACCOUNT_ID`

Secrets in the **development** GitHub environment:

- `VERCEL_TOKEN`: long-lived token authorized for the dev Vercel project.

Variables in the **development** GitHub environment:

```text
VERCEL_ORG_ID=team_OIT5OXebl9EX7rfVRbU0L5qu
VERCEL_PROJECT_ID=prj_KfduKfIdhA3NecvBjmiIaaH0VdbS
```

Keep these IDs scoped to the development environment. Vercel CLI's interactive
OAuth session token expires and is not suitable as the CI token.

## Application environment and secrets

The dev web uses the operator-supplied Aiven `stock_market` database and sandbox
credentials from the private local `.env`. Database isolation depends on which
connection URL is supplied; this setup does not create a new database or schema.
Database migrations remain an explicit `pnpm db:migrate` operation before
deploying a schema change.

The web project's **Production** target contains:

```dotenv
ENVIRONMENT=dev
BETTER_AUTH_URL=https://stock-market-web-dev.vercel.app
WEB_URL=https://stock-market-web-dev.vercel.app
NEXT_PUBLIC_API_URL=https://stock-market-api-dev.auenkr.com
MCP_RESOURCE_URL=https://stock-market-mcp-dev.auenkr.com/mcp
MCP_AUTHORIZATION_SERVER=https://stock-market-web-dev.vercel.app/api/auth
POLAR_SANDBOX_BASIC_PRODUCT_ID=64c26c52-74bb-4f3f-8025-66e9d2c62637
POLAR_SANDBOX_PERSONAL_PRODUCT_ID=99588bd8-83cc-436c-b5b3-1afb0ac6ddfd
POLAR_SANDBOX_PROFESSIONAL_PRODUCT_ID=5e946fcd-51e1-41e1-a32e-a2444d06ed6d
```

Private values: `DB_CONNECTION_URL`, `BETTER_AUTH_SECRET`,
`API_KEY_ENCRYPTION_SECRET`, `ACCOUNT_SERVICE_SECRET`,
`MCP_ACCOUNT_SERVICE_SECRET`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`,
`DEV_USERNAME`, `DEV_PASSWORD`, and `DEV_BILLING_EMAIL`.

Preserve the encryption secret for the supplied database. If its existing keys
used the fallback, set `API_KEY_ENCRYPTION_SECRET` to the original
`BETTER_AUTH_SECRET` plus `:api-key-encryption-v1` before changing the auth secret.
A new encryption key cannot decrypt existing API keys.

The Rust dev API connects directly to the dev database and uses the source
cookie from the supplied Screener credentials. Its Cloudflare Tunnel hostname
is unchanged. The dev MCP uses the dev API and dev web OAuth issuer; its
`MCP_ACCOUNT_SERVICE_SECRET` must match the dev web.

The Rust API cache prefix is `stock-market:dev`. `VALKEY_URL` is optional; when
it is absent, the API fetches upstream directly. The API host reads its runtime
configuration from the existing deployment environment; Wrangler secrets do
not configure this container.

Development password login is available at `/signin`; enter username `dev`
(the form appends `@auenkr.com`) with the existing development account password.
Google login requires its client credentials on the dev project and the redirect
URI `https://stock-market-web-dev.vercel.app/api/auth/callback/google` registered
in Google's console; it is not enabled by this setup.

## Polar sandbox webhook

The hosted dev endpoint is registered in the AuenKr **sandbox** organization:

```text
https://stock-market-web-dev.vercel.app/api/auth/polar/webhooks
```

Endpoint ID: `f2d3f8c0-24fc-460d-84a8-e6813ce2fe30`; payload API version:
`2026-10`. It subscribes to `customer.state_changed`, `subscription.active`,
`subscription.updated`, `subscription.canceled`, `subscription.revoked`,
`subscription.past_due`, `subscription.paused`, `subscription.resumed`, and
`subscription.cycled`. Its own signing secret is stored as
`POLAR_WEBHOOK_SECRET` on the dev web and in this worktree's ignored `.env`.
The existing local-tunnel webhook remains separate.

See [Polar setup](polar-setup.md) for sandbox checkout test steps. The sandbox
portal and signed webhook acceptance were verified (using an unlinked test
customer, with no entitlement changes); subscription purchase/cancellation is a
separate test.

## Manual deployment and verification

From the repository root, after configuring the private provider environments:

The Rust API image runs on the existing Tunnel host. This GitHub workflow
smoke-checks its public endpoint but does not redeploy that container. Update
the API container on its host before promoting a Rust API change.

```sh
pnpm install --frozen-lockfile
pnpm --filter @auenkr/legerline-mcp deploy:dev
vercel link --yes --project stock-market-web-dev
vercel deploy --prod --yes
node scripts/smoke-dev.mjs
```

`scripts/smoke-dev.mjs` verifies public web/auth availability, health for the
tunnel-hosted Rust API and MCP,
dev-only documentation, OAuth issuer/resource/documentation URLs, and signed
API/MCP calls through the dev web account service. It uses invalid credentials
to check rejection and wiring without creating accounts or charging quota.
It does not make payments or run database migrations.

All credential values stay in ignored `.env`, Cloudflare secrets, Vercel
environment variables, or GitHub environment secrets.
