# GitHub Actions CI

The [CI workflow](../.github/workflows/ci.yml) checks approval when a PR is opened, updated, reopened, marked ready, edited (including changing its base), or labeled. Tests and builds run only after explicit approval. Manual dispatch is also supported. Superseded runs are cancelled. PR checkout uses GitHub's proposed merge commit so checks include the target branch's code.

## Approval before running

Both `Tests` and `Build` depend on `Approve CI`. Until approval, only this small metadata check runs; no repository code is checked out, and no dependencies, service containers, tests, or builds start.

To approve a PR, apply the **`ci-approved`** label. The gate verifies that the person applying it has repository write, maintain, or admin access. New commits or base changes cancel the previous run and fail the gate again, even if the label remains present: **remove and reapply the label to approve the new run**. Unrelated labels do not authorize CI. Before approval, `Approve CI` is intentionally failed and the expensive jobs are skipped.

For a manual branch build, open **Actions → CI → Run workflow**, select the branch, and run it. This explicit action counts as approval and is also checked for write access. Manual branch runs test the selected branch; use the PR label to validate GitHub's proposed merge commit.

Required environment reviewers were attempted, but GitHub rejected that configuration because the repository's current plan does not support them for private repositories. Label/manual approval works with the current plan and needs no additional secrets. See [GitHub plan restrictions for environment approvals](https://docs.github.com/en/rest/deployments/environments#about-deployment-environments). No protected-environment gate is used.

## Checks and testing environment

| Required check | Coverage |
| --- | --- |
| `Approve CI` | Explicit approval for the current run by someone with repository write access |
| `Tests` | Generated Swagger drift, all workspace typechecks, API/auth/key tests, disposable PostgreSQL integration tests (including the database-backed atomic quota regression), CLI integration, billing/payment integration, development browser E2E, MCP protocol and authenticated E2E, production documentation/theme browser tests, integration/performance TypeScript checks, k6 smoke and quota scenarios |
| `Build` | Production `pnpm build` for every Nx build target, plus the MCP Cloudflare Worker build |

The runner installs Node 24, the pnpm version pinned in `package.json`, Chromium with its OS dependencies, tmux, and k6 2.0.0. Tests start their Next.js server in the `stock-market` tmux session. PostgreSQL 17 is an ephemeral GitHub Actions service; `TEST_DATABASE_URL` points at that service. Every integration/E2E/performance invocation creates, migrates, and drops a separate `stock_test_*` database. The development account is seeded as `dev@auenkr.com` with the test password from `AGENTS.md`.

Support and legal contact pages default to `support@auenkr.com`. `SUPPORT_EMAIL` and `LEGAL_CONTACT_EMAIL` can override those public addresses; they are not secrets.

**No GitHub Actions secrets are required for these PR checks.** The workflow copies `sample.env` to `.env` because the development seed command requires that file, supplies test-only auth/encryption secrets, and lets the E2E runner provide fake Google/Polar credentials and product IDs. Real auth, database, webhooks and payment lifecycle logic run against loopback fixtures. The MCP E2E uses the seeded login and a newly created dashboard API key against the isolated API/source fixture. No production database, source cookies, OAuth secret, payment token, or deployment credentials are used. Fork PRs can use this same environment.

Failure traces and k6 JSON summaries are uploaded as the `test-results` artifact for seven days. The build validates compilable output; it does not deploy.

## Require passing checks before merging

After the first workflow run, create a ruleset or branch protection rule for `main` in repository **Settings → Rules → Rulesets** (or **Settings → Branches**):

1. Require a pull request before merging.
2. Require **all three** status checks from GitHub Actions: `Approve CI`, `Tests`, and `Build`. The approval check must be required because skipped downstream jobs alone do not establish approval.
3. Enable **Require branches to be up to date before merging**. This approval workflow does not support merge queues; approval is applied to individual PR runs.
4. Apply the rule to the people who should be blocked, including administrators if desired.

GitHub already blocks merging conflicting PRs. A `pull_request` workflow [does not run while a PR has merge conflicts](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request); resolve them and push again to start CI. This workflow does not resolve conflicts automatically. Requiring current-base checks prevents an earlier green run from authorizing a merge after the base has changed. See [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Optional external tests and future deployment secrets

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

Use environment variables (not secrets) for `ENVIRONMENT=dev`, `POLAR_ENVIRONMENT=sandbox`, `DEV_USERNAME=dev`, `DEV_BILLING_EMAIL`, `BETTER_AUTH_URL`, `WEB_URL`, `GOOGLE_CLIENT_ID`, and `POLAR_BASIC_PRODUCT_ID` / `POLAR_PERSONAL_PRODUCT_ID` / `POLAR_PROFESSIONAL_PRODUCT_ID`. See [Polar setup](polar-setup.md) for webhook/product provisioning. Merely adding secrets does not start the external app or webhook tunnel. Live source smoke tests additionally need the Screener `COOKIE` secret.

Load/stress/spike/soak workloads are opt-in capacity experiments; PR CI runs bounded smoke and quota workloads. They can be run locally using [the performance testing guide](testing.md). These and real external service tests are not implied by a green PR check.

If automatic deployment is added later, use separate deployment credentials: `CLOUDFLARE_API_TOKEN` with Worker deployment access, `CLOUDFLARE_ACCOUNT_ID`, and `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`. Deployments and their runtime secrets are not configured by this PR workflow.
