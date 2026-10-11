# Ledgerline CLI

Free Indian company fundamentals without login or keys.

```sh
npx @auenkr/legerline-cli get_v1_company_search --q reliance
npx @auenkr/legerline-cli tools
```

Calls `https://stock-market-api.auenkr.com` by default. Override with `--api-url`, `LEGERLINE_API_URL`, or `set-api-url`. JSON goes to stdout; errors to stderr with a nonzero exit status.
