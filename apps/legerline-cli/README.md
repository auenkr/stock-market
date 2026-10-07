# @auenkr/legerline-cli

CLI for the Legerline stock market API — Indian company financials, ownership,
corporate actions, and peer data. Built for AI agents and shell usage.
Public tools only; internal and market-history endpoints are not included.

## Install

```bash
npm install -g @auenkr/legerline-cli
```

## Get an API key

1. Sign in at the Legerline dashboard (the web app).
2. Open Settings → API Keys and create a new key.
3. Copy the key (starts with `sm_live_`). It is shown once — store it safely.

## Configure

```bash
legerline set-api-key sm_live_...
```

The key is saved to `~/.config/legerline/config.json` (or `$XDG_CONFIG_HOME/legerline/config.json`) with `0600` permissions.

Optional: override the API base URL (default `https://stock-market-api.auenkr.com`):

```bash
legerline set-api-url https://stock-market-api.auenkr.com
```

Environment overrides: `LEGERLINE_API_KEY`, `LEGERLINE_API_URL`.

## Usage

```bash
legerline <tool> [--param value ...]
legerline tools          # list available tools
legerline config         # show config (key hidden)
legerline --help         # full help
```

Examples:

```bash
# Search companies by name
legerline get_v1_company_search --q reliance

# Company profile (pass the symbol from search results unchanged)
legerline get_api_v1_company_profile --symbol /company/RELIANCE/consolidated/

# Financial statements
legerline get_api_v1_profit_loss --symbol /company/RELIANCE/consolidated/
legerline get_api_v1_balance_sheet --symbol /company/RELIANCE/consolidated/
legerline get_api_v1_cash_flow --symbol /company/RELIANCE/consolidated/
legerline get_api_v1_ratios --symbol /company/RELIANCE/consolidated/

# Screen companies (quote the complete expression so the shell passes one value)
legerline get_api_v1_screen --query 'Market Capitalization > 500 AND Price to Earning < 15'
```

Results are JSON on stdout; errors go to stderr with a non-zero exit code:

```
Error: Invalid or expired API key.
Error: Missing --symbol. Example: legerline get_api_v1_company_profile --symbol <value>
Error: Rate limit exceeded. Retry later.
Error: Cannot reach API at https://stock-market-api.auenkr.com
```

## Notes for AI agents

- Always call `get_v1_company_search` (or `get_v1_list_of_company`) first and pass
  the returned `symbol` unchanged to company endpoints.
- For `get_api_v1_screen`, pass one complete expression to `--query`; screening
  does not take a `symbol` and does not require a search call first. Ask for
  unclear thresholds or units rather than inventing them. Use exact measure
  labels from the [screening guide](https://stock-market.auenkr.com/documentation#screening).
- Supported syntax includes comparisons (`>`, `<`, `>=`, `<=`, `=`), arithmetic
  (`+`, `-`, `*`, `/`), parentheses, and `AND`/`OR`. Keep the expression within
  4,000 characters. Quote it as one shell argument; the CLI URL-encodes it.
- Screening JSON rows use displayed column names as keys and include a URL-valued
  `Symbol`. Missing cells remain `null`; the returned rows are the matches
  available for that query, not a guarantee of complete market coverage.
- Amounts are INR rupees; may be `null` when unavailable.
- Free tier is limited to RELIANCE, HDFCBANK, BHARTIARTL, ICICIBANK, SBIN.

Screening requires Personal or Professional access. REST, MCP and CLI requests
share the account's plan access and rate allowance. See the [screening guide](https://stock-market.auenkr.com/documentation#screening)
for the complete supported ratio catalog and agent query-writing examples.
