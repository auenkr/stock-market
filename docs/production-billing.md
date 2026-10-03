# Production billing and database configuration

Provisioned and inspected on **2026-10-03**. Credentials and the database password are not recorded here.

## Completed production provisioning

- Polar CLI active organization: **AuenKr / production**, ID `70b8d3a3-cd00-4532-b8f3-bf9708783b73`.
- The owner changed the production default presentment currency from USD to INR; verified through the CLI before creating products.
- Created and re-read all three production products. Each is public, recurring monthly with interval count 1, fixed INR pricing, tax-exclusive, and no trial.

| Plan | Monthly base price | Production product ID |
| --- | ---: | --- |
| Basic | ₹199 | `9e5e9c9a-3b60-42b2-b7ab-f6e769ad5ed8` |
| Personal | ₹399 | `6a7edd2a-7a21-4464-a4f0-96a9f566f23b` |
| Professional | ₹2,499 | `f803d30f-8c17-4b14-ab0c-4067f24e04cd` |

Hobby has no Polar product or checkout and requires no credit card.

Created production webhook endpoint **`a5f72b5b-7d68-4cab-8b3f-db9a5be9631a`**:

- URL: `https://stock-market.auenkr.com/api/auth/polar/webhooks`
- Raw payloads, API version `2026-10`, enabled.
- Events: `customer.state_changed`, `subscription.active`, `subscription.updated`, `subscription.canceled`, `subscription.revoked`, `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `subscription.cycled`.
- Copy this endpoint's signing secret from the production Polar dashboard into the web deployment's `POLAR_WEBHOOK_SECRET`. The secret was not written to the repository.

At inspection, Polar organization status was `created`; `checkout_payments`, `subscription_renewals`, and `payouts` were false. Complete Polar merchant/payout onboarding and confirm payment capability before accepting live purchases. No production payment was attempted.

## Production database

Target: the supplied Aiven connection, database **`prod_db`**, TLS verified. The database initially had no application tables.

Completed in this order:

1. Current Drizzle schema initialization using `drizzle-kit push --force` against the empty database.
2. `0010_billing_and_consent.sql` via `packages/db/scripts/migrate-billing.mjs`.
3. `0011_four_tier_plans.sql` via `packages/db/scripts/migrate-four-tier-plans.mjs`.

Verified all seven application tables: `user`, `session`, `account`, `verification`, `api_key`, `usage_policy`, `account_usage`.

Verified the user plan constraint permits `free` (Hobby), `basic`, `personal`, and `professional`. Verified usage policies: `default=10`, `basic=60`, `personal=300`, `professional=500`. The four-tier migration inserts a missing Hobby default without replacing an existing custom default policy. No production test account was seeded; users and API keys were empty at initialization.

Set `DB_CONNECTION_URL` to the exact supplied private production connection URL, including `sslmode=require`. This provisioning initializes a new database; it does not copy accounts, keys or sessions from any previous database. Do not rerun older plan migrations after the four-tier migration.

## Web: Vercel `stock-market-web`, Production environment

The verified custom production domain is `stock-market.auenkr.com`. Add the following variables to **Production**, then deploy the four-tier application code:

```dotenv
POLAR_PRODUCTION_BASIC_PRODUCT_ID=9e5e9c9a-3b60-42b2-b7ab-f6e769ad5ed8
POLAR_PRODUCTION_PERSONAL_PRODUCT_ID=6a7edd2a-7a21-4464-a4f0-96a9f566f23b
POLAR_PRODUCTION_PROFESSIONAL_PRODUCT_ID=f803d30f-8c17-4b14-ab0c-4067f24e04cd
POLAR_ACCESS_TOKEN=<production-organization-access-token>
POLAR_WEBHOOK_SECRET=<signing-secret-for-endpoint-a5f72b5b-7d68-4cab-8b3f-db9a5be9631a>
DB_CONNECTION_URL=<supplied-private-Aiven-prod_db-URL>
ENVIRONMENT=production
BETTER_AUTH_URL=https://stock-market.auenkr.com
WEB_URL=https://stock-market.auenkr.com
NEXT_PUBLIC_API_URL=https://stock-market-api.auenkr.com
```

Create the production organization access token in Polar with `customers:read`, `customers:write`, `checkouts:write`, and `customer_sessions:write`. The CLI's saved production login does not configure the web deployment's server token. Sandbox tokens/product IDs/webhook secrets are not valid for this configuration.

The Vercel Production environment listing currently includes `DB_CONNECTION_URL`, `ENVIRONMENT`, `BETTER_AUTH_URL`, `WEB_URL`, `NEXT_PUBLIC_API_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ACCOUNT_SERVICE_SECRET`. Values were not downloaded; the list establishes presence, not correctness. No `POLAR_*` variables were present at inspection.

Keep the existing stable `BETTER_AUTH_SECRET`, Google credentials, and `ACCOUNT_SERVICE_SECRET`. If `API_KEY_ENCRYPTION_SECRET` is already set, preserve it; otherwise the application uses its existing auth-secret-derived fallback. Google OAuth must allow `https://stock-market.auenkr.com/api/auth/callback/google`.

Also provide actual public operator details used by the legal/support pages:

```dotenv
LEGAL_ENTITY_NAME=<actual-operator-or-business-name>
LEGAL_CONTACT_EMAIL=<public-support-and-privacy-email>
LEGAL_ADDRESS=<actual-business-address>
```

No deployed Vercel variables were modified by this provisioning task.

## API: Cloudflare Worker `stock-market-api`

Use the existing signed account-service architecture:

```dotenv
ENVIRONMENT=production
ACCOUNT_SERVICE_URL=https://stock-market.auenkr.com/api/internal/account-access
ACCOUNT_SERVICE_SECRET=<same-existing-value-as-web>
PUBLIC_URL=https://stock-market-api.auenkr.com
BASE_URL=https://www.screener.in
COOKIE=<existing-valid-source-session-secret>
```

`PUBLIC_URL` and `BASE_URL` are already declared in `apps/api/wrangler.jsonc`. `ACCOUNT_SERVICE_URL`, `ACCOUNT_SERVICE_SECRET`, and `COOKIE` were present in the deployed Worker's secret-name listing; values were not retrieved. Verify the URL targets the production web service, and preserve the matching shared signing secret and source session. Set `ENVIRONMENT=production` as a Worker variable to keep Internal documentation hidden.

With `ACCOUNT_SERVICE_URL` configured, the Worker delegates key validation and account quotas to the web service, which connects to `prod_db`. The Worker does not need Polar billing variables or a database connection binding for this architecture. Redeploy it with the new code so it accepts the `basic` account-plan response and enforces Basic's detailed-data restrictions.

No deployed Worker variables or secrets were modified by this provisioning task.

## Release sequence

At inspection, local `main` still contains the prior three-tier plan implementation (free Basic, Personal ₹2,000, Professional ₹5,000). Product/environment changes alone cannot enable Basic checkout or update display/access rules.

1. Integrate the four-tier pricing changes into `main`.
2. Supply the web Production variables above. The new database is already initialized and migrated.
3. Deploy the updated API and web services as a coordinated release; the older Worker rejects `basic` responses from the new web account service. Allow temporary request retries during rollout.
4. Confirm the production pricing page shows Hobby/Basic/Personal/Professional, and the public/plugin OpenAPI advertises the same policy.
5. Confirm Polar onboarding/payment capability, webhook secret verification, and actual customer checkout/activation. Check webhook delivery errors in Polar. Do not use sandbox cards in production.

The catalog, webhook registration and database provisioning are completed infrastructure changes. Web/API deployment and live payment acceptance are separate remaining steps.
