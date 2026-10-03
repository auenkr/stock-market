# Production deployment

`.github/workflows/deploy-prod.yml` runs on every push to `main`. It can also be
started from the Actions tab with **Run workflow**, selecting the `main` branch.
Independent jobs deploy the API, hosted MCP server, and both public npm packages
(CLI and MCP). Vercel deploys the web app through its existing GitHub integration.
Production runs are serialized so deployments do not overlap.

Protect `main` in the GitHub repository settings: require pull requests before
merging and disallow direct pushes (including administrator bypass if direct
pushes must be impossible). The deployment workflow only deploys commits on
`main`; it does not enforce branch protection.

## GitHub Actions secrets

Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Custom token with Account → Workers Scripts → Edit for the production account, plus Zone → Zone → Read and Zone → Workers Routes → Edit for `auenkr.com`. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account hosting the API and MCP Workers. |
| `NPM_TOKEN` | npm granular access token with write access to both `@auenkr/legerline-cli` and `@auenkr/legerline-mcp`, and permission to publish non-interactively (bypass 2FA). |

## Web: Vercel

Configure the Vercel project's **Root Directory** as `apps/web`, its framework as
Next.js, and its production branch as `main`. Keep access to files outside the
root directory enabled for the workspace packages. The build command is defined
in `apps/web/vercel.json`.

Configure production application environment variables in Vercel, including the
database, authentication, account-service, and Polar settings documented in the
root README and [Polar setup](polar-setup.md). Keep Vercel's Git-based automatic
deployment enabled. GitHub Actions does not need Vercel secrets.

Vercel Preview deployments (`VERCEL_ENV=preview`) can render pricing and other
pages without complete Polar billing settings. If only some credentials/product
IDs are configured, checkout is disabled and a configuration warning is logged.
To exercise checkout in a preview, configure the sandbox credentials and
`POLAR_SANDBOX_*_PRODUCT_ID` values from [Polar setup](polar-setup.md).
`ENVIRONMENT=dev` selects Polar sandbox; `ENVIRONMENT=production` selects the
production account and `POLAR_PRODUCTION_*_PRODUCT_ID` values. In production and
local development, partially configured billing remains an error; complete
billing settings are required.

## Minimum deployment token permissions

### Cloudflare

Create a custom API token with these permissions:

- **Account → Workers Scripts → Edit**, scoped to the production account only.
- **Zone → Zone → Read**, scoped to `auenkr.com` only, for Wrangler's zone lookup.
- **Zone → Workers Routes → Edit**, scoped to `auenkr.com` only, for Wrangler's
  route inspection and synchronization during deployment.

Both Workers use `custom_domain: true`. Custom Domain attachment is authorized by
Workers Scripts Edit, but Wrangler also inspects zone routes during deployment,
so Workers Routes Edit is required by this deployment path. DNS Edit is not
required. No KV, R2, D1, Pages, or account administration permissions are needed.
The Workers Scripts permission is account-scoped, not restricted to just the two
Worker names.

### npm

Create a granular access token with:

- **Packages and scopes → Read and write (publish and stage)**.
- **Only select packages and scopes**: select `@auenkr/legerline-cli` and
  `@auenkr/legerline-mcp`, rather than the whole scope.
- **Bypass two-factor authentication** enabled for non-interactive publishing.
- **Organizations → No access**; organization administration is not needed to
  publish organization-owned packages.

The token's owner must already have publish access to both packages. If a package
has never been published and cannot be selected yet, publish its first version
manually, then create the package-scoped CI token. The package publishing policy
must allow granular tokens; a policy that disallows tokens will reject this setup.

The workflow's GitHub token only requires `contents: read` for checkout.

## API and MCP: Cloudflare Workers

The API uses `apps/api/wrangler.jsonc` and deploys to
`https://stock-market-api.auenkr.com`. The MCP server uses
`apps/mcp/wrangler.jsonc` and deploys to
`https://stock-market-mcp.auenkr.com/mcp`. Both Wrangler configurations build their
Worker bundle before deployment and attach the existing production custom domains.

Provision runtime secrets separately in Cloudflare. In particular, configure the
API's `ACCOUNT_SERVICE_URL` to point to the web app's
`/api/internal/account-access` endpoint and set the same `ACCOUNT_SERVICE_SECRET`
on the API and web app. Existing Worker secrets are retained by deployment; the
GitHub Cloudflare token is only for deploying Workers.

Apply required database migrations before pushing application changes that need
them; this workflow does not run database migrations.

## CLI and MCP: npm

The public CLI is `@auenkr/legerline-cli` in `apps/legerline-cli` (the separate
`apps/cli` package is an internal scraping tool). The MCP npm package is
`@auenkr/legerline-mcp` in `apps/mcp`, published independently of its hosted Worker.
Bump the `version` in `apps/legerline-cli/package.json` or `apps/mcp/package.json`
before merging a release of that package to `main`. Update the lockfile with
`pnpm install` if needed.

The workflow builds and publishes versions that are absent from npm. Already
published versions are skipped, allowing ordinary web/API/MCP deployments and
workflow reruns without trying to overwrite an immutable npm release. Registry
errors fail the job rather than being treated as unpublished versions.
