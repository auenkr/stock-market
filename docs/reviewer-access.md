# Ledgerline reviewer access

Dedicated review account, documented here at the repository owner’s request.

Login URL: https://stock-market.auenkr.com/reviewer/signin
Email: reviewer@auenkr.com
Password: 5_hWc-RzYVmHlc9e2FVA2sLFQ90eUasujvZcYgPG-J8

The same credentials are provisioned in `stock_market` and `prod_db`. The account has a verified email and completed profile. Sign in directly with email and password; no Google approval or MFA is required. The login URL is unlisted and excluded from search indexing. Public signup cannot create password accounts.

Production (`prod_db`): Professional subscription activated through Polar checkout using `REVIEWER` (100% discount). Checkout showed ₹0/month and ₹0 tax, with no card required. Paid access is confirmed through 2026-11-04; the dashboard displays the standard list price separately.

Development (`stock_market`): login account exists on Hobby; no second subscription was purchased.

Open the login URL, sign in, then connect Ledgerline in ChatGPT in the same browser and approve company-data access. Run the five positive and three negative prompts in `plugins/ledgerline/plugin.json`.

## Administrator provisioning

Supply `DB_CONNECTION_URL` securely, then run:

```sh
pnpm db:create:password-account --email reviewer@example.com --plan free --credentials-file /private/path/reviewer.md
```

The script creates a verified user with a completed profile and a hashed password. It refuses existing accounts and writes a credential document with file mode 0600. Use `--password-file` to reuse a password across databases; otherwise it generates one. `--plan` can provision an expiring access grant, but does not create a paid subscription. Purchase subscriptions through checkout.

The credential document is not included in the public plugin ZIP.
