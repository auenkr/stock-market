# Monthly plans and Polar setup

For the provisioned production catalog, webhook, Aiven schema, and production web/API environment values, see [production billing configuration](production-billing.md). Sandbox IDs below must not be used in production.

## Plans

| Plan | Monthly base price | Requests/minute/account | Access | License |
| --- | ---: | ---: | --- | --- |
| Hobby (`free`) | ₹0, no credit card | 10 | Free endpoints and five-company allowlist | Personal/non-commercial |
| Basic (`basic`) | ₹199 | 60 | Free endpoints and all supported companies | Personal/non-commercial |
| Personal (`personal`) | ₹399 | 300 | All endpoints and supported companies | Personal/non-commercial |
| Professional (`professional`) | ₹2,499 | 500 | Personal + commercial use | Commercial integration permitted |

Ledgerline bills paid plans **monthly**. Hobby is free ongoing service access, with no payment checkout or card required. Its internal ID remains `free` for existing accounts. Basic does not unlock endpoints labeled Paid: those require Personal or Professional. “All endpoints” removes plan restrictions; documented source gaps, null fields, exclusions, and 501 responses still apply. REST, ChatGPT and MCP share account access and allowances.

## 1. Create the Polar organization

Start in [Polar Sandbox](https://sandbox.polar.sh). Create a sandbox organization for testing. Create your production organization separately at [polar.sh](https://polar.sh) and complete Polar's merchant/business verification and payout onboarding before accepting live payments.

Sandbox and production have separate organizations, tokens, products, subscriptions, and webhook secrets. Configure one complete set per deployment.

## 2. Create three monthly recurring products

In **Products → New product**, create:

- **Ledgerline Basic**: recurring, **monthly**, interval count **1**, fixed price **INR 199** (API minor-unit amount: `19900`). Describe 60 requests/minute, free/basic-data endpoints for all supported companies, personal/non-commercial use only.
- **Ledgerline Personal**: recurring, **monthly**, interval count **1**, fixed price **INR 399** (API minor-unit amount: `39900`). Describe 300 requests/minute, all endpoints, personal/non-commercial use only.
- **Ledgerline Professional**: recurring, **monthly**, interval count **1**, fixed price **INR 2,499** (API minor-unit amount: `249900`). Describe 500 requests/minute, all endpoints, and commercial use subject to the Terms of Service.

Set the organization's default payment currency to **INR** and use INR as the products' payment currency, so server-side checkout creation cannot fall back to a different currency. Choose tax-exclusive pricing if the displayed amounts are intended as base prices plus applicable tax; Polar shows the final amount at checkout. Disable trials. The application also disables checkout trials and does not grant paid access to trialing subscriptions.

Copy each **product ID**, not a price ID or checkout-link ID. No Hobby product, usage meters, per-request charges, feature flags, or license-key benefits are needed; the service manages endpoint entitlements and API keys itself.

Configure Polar's customer portal to allow customers to switch between these three products and cancel at period end. Select the desired upgrade/downgrade proration behavior in Polar; customers see its effective date and charges. Existing subscribers use the portal, rather than creating another subscription checkout. New catalog prices do not retroactively establish a changed renewal price for existing subscriptions; review those separately.

## 3. Create an organization access token

Under **Settings → Developers → New Token**, create a server-only token with these scopes:

- `customers:read`
- `customers:write`
- `checkouts:write`
- `customer_sessions:write`

These cover customer creation/synchronization, customer-state lookups, checkout creation, and customer-portal sessions. The app uses the authenticated customer portal for subscription management; it does not need organization-wide subscription administration permissions. Choose a token expiry appropriate for your operations and replace the secret before it expires.

## 4. Configure webhooks

In **Settings → Webhooks**, add:

```text
https://<your-dashboard-domain>/api/auth/polar/webhooks
```

For local sandbox testing, expose the **web dashboard port** through an HTTPS tunnel and use that origin with the same path. This endpoint is on the Next.js/Better Auth service, not the separate data API Worker. Your `WEB_PORT` may differ from the sample's 3001.

Subscribe to these events (the current implementation registers all of them):

```text
customer.state_changed
subscription.active
subscription.updated
subscription.canceled
subscription.revoked
subscription.past_due
subscription.paused
subscription.resumed
subscription.cycled
```

Select the **2026-10 API/payload version** when Polar offers a version selector; this implementation uses `@polar-sh/sdk/2026-10`. Copy the webhook signing secret exactly as Polar displays it. Signature verification is performed by the Better Auth Polar plugin. Failed handlers return an error so Polar retries.

Customer-state events save a local entitlement snapshot. Subscription events fetch the current Polar customer state, then reconcile it. Duplicate/delayed deliveries cannot overwrite newer snapshots. An end-of-period cancellation preserves access until the paid period ends; past-due/paused/revoked states lose paid access. Access expires automatically in the database even if an end-of-period webhook is delayed. Renewals update the expiration.

## 5. Set application configuration

Add these to the root `.env` locally and to the **web server's private environment** in deployment:

```dotenv
POLAR_ACCESS_TOKEN=<organization-access-token>
POLAR_WEBHOOK_SECRET=<webhook-signing-secret>
POLAR_SANDBOX_BASIC_PRODUCT_ID=<sandbox-basic-monthly-product-id>
POLAR_SANDBOX_PERSONAL_PRODUCT_ID=<sandbox-personal-monthly-product-id>
POLAR_SANDBOX_PROFESSIONAL_PRODUCT_ID=<sandbox-professional-monthly-product-id>
POLAR_PRODUCTION_BASIC_PRODUCT_ID=<production-basic-monthly-product-id>
POLAR_PRODUCTION_PERSONAL_PRODUCT_ID=<production-personal-monthly-product-id>
POLAR_PRODUCTION_PROFESSIONAL_PRODUCT_ID=<production-professional-monthly-product-id>

BETTER_AUTH_URL=https://<your-dashboard-domain>
BETTER_AUTH_SECRET=<stable-random-secret-at-least-32-characters>
LEGAL_ENTITY_NAME=<operator-or-business-name>
LEGAL_CONTACT_EMAIL=<support-and-privacy-contact-email>
LEGAL_ADDRESS=<operator-business-address>
```

Keep the existing Google OAuth and API key encryption configuration. Register the actual web origin's `/api/auth/callback/google` with Google. In production set `ENVIRONMENT=production` to disable development password login. No Polar token or webhook secret belongs in `NEXT_PUBLIC_*`, frontend code, or the data API's bindings.

`ENVIRONMENT=dev` selects Polar's sandbox API and the `POLAR_SANDBOX_*_PRODUCT_ID` catalog. `ENVIRONMENT=production` selects Polar's production API and `POLAR_PRODUCTION_*_PRODUCT_ID` catalog. The six product IDs have code defaults from the confirmed Polar catalogs; set the corresponding variables only to override them. `POLAR_ACCESS_TOKEN` and `POLAR_WEBHOOK_SECRET` must still match the selected account in each deployment environment. With both credentials unset, pricing and Hobby work and paid subscription actions are disabled; partial credential configuration fails explicitly.

The Terms of Service and Privacy Policy are at `/terms-of-service` and `/privacy-policy`. Their text describes Ledgerline, its actual data collection, monthly plans, and Polar billing. Set the operator and contact variables before the production build so the published static pages contain your details. Changes to the policy text should update `legalVersion` in `packages/auth/src/consent.ts` as well.

## 6. Apply the schema and deploy

For an existing database already using account plans and usage counters:

```sh
pnpm db:migrate
```

The migrations read `DB_CONNECTION_URL` from `.env`. Billing adds subscription expiration, reconciliation timestamp, Polar customer ID, and consent audit fields. The four-tier migration adds Basic's 60/minute policy and expands the database constraint, preserving existing accounts and subscriptions. Personal remains 300/minute, Professional 500/minute, and Hobby retains the default policy. Legacy manually assigned `paid` rows become Hobby: an old manual flag is not a verified payment subscription. Existing API keys remain valid. Existing users can accept the current policies in Plans & billing before subscribing.

For a fresh database, `pnpm db:push` creates the full schema; runtime defaults supply the four allowances. Apply migrations before rolling out the updated web and data API code. Do not rerun earlier plan migrations after the four-tier migration.

Build and restart/deploy the web application and data API. For the signed account-service deployment, keep `ACCOUNT_SERVICE_URL` pointing to the web service's `/api/internal/account-access` and use the same `ACCOUNT_SERVICE_SECRET` on both services. The account-service bridge returns `free` (Hobby), `basic`, `personal`, or `professional`.

## 7. Verify in sandbox, then production

1. Open `/signup`, accept both policies, and complete Google signup/onboarding. Acceptance time and policy versions are recorded server-side; OAuth cannot create a new account without the signed consent cookie.
2. Create an API key on Hobby without entering payment details and verify restricted access and 10/minute. Subscribe to Basic and verify 60/minute and all companies on free endpoints, with detailed endpoints still returning `403 PAID_PLAN_REQUIRED`.
3. Open **Plans & billing**, choose Personal, and pay with a Polar sandbox test payment method. Confirm the webhook delivery succeeds and the page shows Personal with 300 requests/minute. “Refresh subscription status” can reconcile a delayed webhook. The checkout success URL alone does not activate access.
4. Upgrade to Professional through **Manage subscription & invoices**. Verify 500/minute and commercial permission. The same API key uses the new allowance.
5. Cancel at period end and verify access lasts through the paid period. Test revocation/failed payment and verify fallback to Hobby, then payment recovery and reactivation.
6. In the Polar webhook dashboard, retry a delivery and verify the plan remains correct. Check failed deliveries before launch.
7. Repeat a real low-value transaction/refund as appropriate after configuring the production organization; automated tests do not make real payments.

Existing accounts created before billing was configured are lazily created in Polar on first checkout/status refresh, using the authenticated Better Auth user ID as Polar's external customer ID. An existing conflicting customer email is not silently reassigned; resolve such conflicts in Polar.

Polar validates deliverable email domains even in sandbox and rejects reserved domains such as `@ledgerline.test`, `.invalid`, and `.example`. Accounts using those fall back to `DEV_BILLING_EMAIL`. The seeded development account signs in as `dev@auenkr.com`, which matches `DEV_BILLING_EMAIL`, so its Polar customer uses that address directly, is marked as a development account, and remains linked to the normal Better Auth user ID. Google accounts use their actual account email.

## Configured local sandbox

The CLI is authenticated to the **AuenKr** sandbox organization (`fd5c7016-c171-4db4-ab1b-ef653a17636b`). Local `.env` contains the sandbox token and webhook secret; these are git-ignored.

In this isolated worktree, the ignored `.env` stores the new Basic product ID; the running dev process loads existing private credentials from the main checkout before this overlay. To restart with the same configuration, supply the private environment first:

```sh
node --env-file=<existing-private-env> --env-file=.env scripts/dev.mjs
```

For an independent deployment, populate all values in section 5 in its own private environment. No credentials are committed.

| Resource | ID / configuration |
| --- | --- |
| Basic product | `64c26c52-74bb-4f3f-8025-66e9d2c62637` — INR 199 every month |
| Personal product | `99588bd8-83cc-436c-b5b3-1afb0ac6ddfd` — INR 399 every month |
| Professional product | `5e946fcd-51e1-41e1-a32e-a2444d06ed6d` — INR 2,499 every month |
| Webhook endpoint | `bf10b5bd-bd43-43bf-8fed-fcec1a8f3778` — API version `2026-10`, all nine events above |
| Webhook URL | `https://marbles-stabilize-paying.ngrok-free.dev/api/auth/polar/webhooks` |
| Dashboard | `http://localhost:3000/dashboard/billing` |

The organization uses INR as its default currency, prorated subscription changes, one subscription per customer, and customer-portal plan changes. All three products are INR-only, monthly, tax-exclusive, and have no trial. The Polar CLI sandbox catalog was updated on 2026-10-03; existing Personal/Professional product IDs were retained. Keep ngrok forwarding to port 3000 while testing; update the webhook URL if the tunnel address changes.

On 2026-10-03, the Polar CLI catalog was configured and three real sandbox checkout sessions were created through the SDK; each returned the expected INR base amount (19,900 / 39,900 / 249,900 minor units). The local four-tier migration was applied and the dev server restarted in `tmux stock-market:pricing-dev`. The real sandbox purchase suite stopped before purchasing because `dev@auenkr.com` already had an active subscription; that subscription was preserved. Fresh purchase/webhook verification for the new prices remains pending a free testing account. The isolated integration and browser suites verify successful payment, activation, renewal failure/recovery and revocation for all three paid plans.

Automated payment coverage:

- `TEST_MODE=LOCAL pnpm test:integration` — includes `packages/auth/tests/payment.integration.test.ts`, a loopback Polar/Stripe substitute for all three paid plans (real auth, checkout creation, signature verification, and quota storage): declined cards grant nothing, a `4242 4242 4242 4242` retry activates the existing key only after verified payment webhooks, renewals extend expiry, failed renewals fall back to Hobby, recovery reactivates, refunds alone cannot revoke, revocation returns to Hobby, and duplicate deliveries are safe. No real charge is made. Payment suites are excluded in `TEST_MODE=CICD` by the [documented founder decision](ci.md#decision-payment-checks-are-opt-in-2026-10-03).
- `TEST_MODE=LOCAL pnpm test:e2e` — includes `apps/web/tests/browser/payment.spec.ts`, which drives the same loopback checkout form in a real browser: declined card, retry with `4242 4242 4242 4242`, activation, renewal failure/recovery, and revocation for all three paid plans.
- `pnpm test:payments:live` — `apps/web/tests/payments-live/payment.spec.ts` signs in as `dev@auenkr.com` (`test-development-password`) against the running dev app, completes real sandbox checkout for all three paid plans (manual `4242 4242 4242 4242` entry on a fresh customer, saved-card reuse on later runs), verifies the paid order, current base amount, INR/monthly subscription, webhook-driven plan activation, and the updated key allowance, then revokes each test subscription via the Polar CLI and confirms the account returns to Hobby. Requires the dev servers, ngrok webhook, and sandbox `.env` from this guide. It refuses to remove a pre-existing subscription.

## Automated verification

```sh
pnpm test:auth
pnpm test:api
pnpm test:integration
pnpm test:e2e
pnpm typecheck
pnpm docs:check
```

Integration and E2E runners create/drop disposable PostgreSQL databases. Integration tests use the real Better Auth/Polar plugin, signed webhook handler, local HTTP billing fixtures, and real quota storage. Browser tests use the real Next.js console, Google authorization-start flow, policy acceptance, API key creation, signed webhooks, billing display, and signed account-service endpoint. Google’s remote page is isolated at the browser network boundary; no external OAuth token exchange or real Polar card charge is performed. The E2E server runs in the designated `stock-market` tmux session on port 3105.

References: [Better Auth integration](https://polar.sh/docs/integrate/sdk/adapters/better-auth), [Products and INR pricing](https://polar.sh/docs/features/products), [Organization access tokens](https://polar.sh/docs/integrate/oat).
