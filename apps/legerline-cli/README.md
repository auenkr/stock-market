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
- Amounts are INR rupees; may be `null` when unavailable.
- Free tier is limited to RELIANCE, HDFCBANK, BHARTIARTL, ICICIBANK, SBIN.
