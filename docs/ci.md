# GitHub Actions CI

The [CI workflow](../.github/workflows/ci.yml) automatically runs tests and builds for every PR when it is opened, updated, reopened, marked ready, or edited (including changing its base). There are no branch filters or manual approval jobs. Manual dispatch is also supported. Superseded runs are cancelled. PR checkout uses GitHub's proposed merge commit so checks include the target branch's code.

## Automatic runs

`Tests` and `Build` start independently on each PR event, including draft PRs. No label or approval is required. Changing labels does not rerun CI; pushing a new commit starts a fresh run and cancels the superseded one.

For a manual branch build, open **Actions → CI → Run workflow**, select the branch, and run it. Manual branch runs test the selected branch; automatic PR runs validate GitHub's proposed merge commit.

## Checks and testing environment

| Required check | Coverage |
| --- | --- |
| `Tests` | Generated Swagger drift, all workspace typechecks, API/auth/key tests, disposable PostgreSQL integration tests (including the database-backed atomic quota regression), CLI integration, billing authorization/webhooks, development browser E2E, MCP protocol and authenticated E2E, production documentation/theme browser tests, integration/performance TypeScript checks, k6 smoke and quota scenarios; purchase/payment suites are excluded |
| `Build` | Production `pnpm build` for every Nx build target, plus the MCP Cloudflare Worker build |

The runner installs Node 24, the pnpm version pinned in `package.json`, Chromium with its OS dependencies, tmux, and k6 2.0.0. Tests start their Next.js server in the `stock-market` tmux session. PostgreSQL 17 is an ephemeral GitHub Actions service; `TEST_DATABASE_URL` points at that service. Every integration/E2E/performance invocation creates, migrates, and drops a separate `stock_test_*` database. The development account is seeded as `dev@auenkr.com` with the test password from `AGENTS.md`.

Support and legal contact pages default to `support@auenkr.com`. `SUPPORT_EMAIL` and `LEGAL_CONTACT_EMAIL` can override those public addresses; they are not secrets.

**No GitHub Actions secrets are required for these PR checks.** The workflow copies `sample.env` to `.env` because the development seed command requires that file, supplies test-only auth/encryption secrets, and lets the E2E runner provide fake Google/Polar credentials and product IDs. Auth, database, billing authorization and webhook logic run against loopback fixtures. The MCP E2E uses the seeded login and a newly created dashboard API key against the isolated API/source fixture. No production database, source cookies, OAuth secret, payment token, or deployment credentials are used. Fork PRs can use this same environment.

Failure traces and k6 JSON summaries are uploaded as the `test-results` artifact for seven days. The build validates compilable output; it does not deploy.

## Require passing checks before merging

After the first workflow run, create a ruleset or branch protection rule for `main` in repository **Settings → Rules → Rulesets** (or **Settings → Branches**):

1. Require a pull request before merging.
2. Require GitHub Actions `Tests` and `Build`, plus `Vercel` and `Vercel Preview Comments` from the Vercel integration. The active repository ruleset enforces these four checks without an administrator bypass. There is no CI approval check.
3. Enable **Require branches to be up to date before merging**. This workflow does not currently configure merge-queue events.
4. Apply the rule to the people who should be blocked, including administrators if desired.

GitHub already blocks merging conflicting PRs. A `pull_request` workflow [does not run while a PR has merge conflicts](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request); resolve them and push again to start CI. This workflow does not resolve conflicts automatically. Requiring current-base checks prevents an earlier green run from authorizing a merge after the base has changed. See [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Optional external tests and future deployment secrets

### Decision: payment checks are opt-in (2026-10-03)

The founder requested that payment checks be removed from automatic CI because purchasing requires manual verification. Every PR now runs without purchase/payment suites. A passing PR does **not** establish that purchasing works.

- `packages/auth/tests/payment.integration.test.ts` is excluded in `TEST_MODE=CICD`.
- `apps/web/tests/browser/payment.spec.ts` is excluded in `TEST_MODE=CICD`.
- Real Polar sandbox purchasing (`pnpm test:payments:live`) remains a separately invoked check requiring the testing account, sandbox configuration and webhook tunnel.
- The simulated integration/browser purchase suites are automated fixtures, but are also excluded to keep the entire purchase flow opt-in as requested. Pricing, consent, billing authorization, signed subscription-state webhooks and account limits remain covered by CI.
- GitHub Actions sets `TEST_MODE=CICD`, and `pnpm test:ci` forces that mode regardless of the caller's shell. This single mode also excludes the existing webhook lifecycle checks and Redis/Valkey service checks; API/MCP fixtures run with caching disabled, and CI does not install or start Redis/Valkey. Pure cache logic unit tests still run without a service.

To explicitly include simulated payment suites locally:

```sh
TEST_MODE=LOCAL pnpm test:integration
TEST_MODE=LOCAL pnpm test:e2e
```

Local mode is also the default when `TEST_MODE` is unset and starts disposable Redis/Valkey for cache coverage, including the MCP browser journey. The previous per-suite enable flags are replaced by `TEST_MODE`. Manually verify actual sandbox checkout, receipt amounts, paid-plan activation, plan changes and cancellation before releasing billing changes. Record that evidence separately from the required PR checks.

`pnpm test:payments:live` is an opt-in external sandbox suite, separate from PR CI. It requires a running development app, a seeded test account with no existing subscription, and a reachable webhook endpoint. For that environment, store these sensitive values in a dedicated GitHub testing environment if you later automate it:

| Secret | Purpose |
| --- | --- |
| `DB_CONNECTION_URL` | Dedicated sandbox database, never the production database |
| `BETTER_AUTH_SECRET` | Auth sessions and signed account service |
| `API_KEY_ENCRYPTION_SECRET` | Stored dashboard API key encryption |
| `DEV_PASSWORD` | Seeded sandbox account login |
| `POLAR_ACCESS_TOKEN` | Polar **sandbox** organization access |
| `POLAR_WEBHOOK_SECRET` | Sandbox webhook signature verification |
| `GOOGLE_CLIENT_SECRET` | Only needed if testing actual Google OAuth completion |

Use environment variables (not secrets) for `ENVIRONMENT=dev`, `DEV_USERNAME=dev`, `DEV_BILLING_EMAIL`, `BETTER_AUTH_URL`, `WEB_URL`, `GOOGLE_CLIENT_ID`, and the `POLAR_SANDBOX_*_PRODUCT_ID` values. `ENVIRONMENT=dev` selects the Polar sandbox API; production deployment uses the production catalog and credentials. See [Polar setup](polar-setup.md) for webhook/product provisioning. Merely adding secrets does not start the external app or webhook tunnel. Live source smoke tests additionally need the Screener `COOKIE` secret.

Load/stress/spike/soak workloads are opt-in capacity experiments; PR CI runs bounded smoke and quota workloads. They can be run locally using [the performance testing guide](testing.md). These and real external service tests are not implied by a green PR check.

If automatic deployment is added later, use separate deployment credentials: `CLOUDFLARE_API_TOKEN` with Worker deployment access, `CLOUDFLARE_ACCOUNT_ID`, and `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`. Deployments and their runtime secrets are not configured by this PR workflow.

### Which flows are excluded from CICD and how

CICD exclusion is driven by a single mode, `TEST_MODE=CICD` (GitHub Actions sets it for every step; `pnpm test:ci` forces it):

- `apps/api/tests/run.mjs` omits `packages/auth/tests/payment.integration.test.ts`.
- `apps/web/playwright.config.ts` excludes `apps/web/tests/browser/payment.spec.ts` via `testIgnore`.
- Per-test skips use `{ skip: process.env.TEST_MODE === "CICD" }` (see `packages/auth/tests/billing.integration.test.ts`) or `test.skip(process.env.TEST_MODE === "CICD", ...)` (see `apps/web/tests/browser/billing.spec.ts`).
- No Redis/Valkey service starts in CICD (`INTEGRATION_VALKEY_URL` is empty, `CACHE_ENABLED=false`), so Valkey-backed cache and service checks are skipped; pure cache logic unit tests still run.

Rule of thumb: only flows that need a real external system (payments, webhooks, Valkey services, paid network calls) are disabled in CICD. Browser and API flows that run against the disposable database still run in CICD; if such a flow is found to be genuinely untestable in CI, disable it with one of the above mechanisms and note why here.

### Browser E2E timing in CICD

Browser E2E runs through a dev server (`scripts/dev-app.mjs web`), and on a cold CI runner the first navigation to an uncompiled route can wait on on-demand chunk compilation. Nav-dependent assertions therefore use longer budgets (for example `{ timeout: 30_000 }` in `apps/web/tests/browser/mcp-oauth.spec.ts` and `apps/web/tests/browser/billing.spec.ts`) instead of the 5s default. Do not lower these; a slow first compile used to fail otherwise healthy CI runs.
