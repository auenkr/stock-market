# Company screening

`GET /api/v1/screen?query=...` runs a financial screening expression. The `/v1/screen` alias is also available. This endpoint is free and requires no login or API key.

## Write a query

Use the exact measure names from the supported-measures list below. For example:

```text
Market Capitalization > 500 AND Price to Earning < 15
```

This keeps companies with a market capitalization above 500 and a price-to-earning value below 15. `AND` requires both conditions; use `OR` when either condition can match. Numeric values use the measure's displayed units.

Send the expression with an HTTP client that URL-encodes query parameters:

```bash
curl --get 'https://stock-market-api.auenkr.com/api/v1/screen' \
  --data-urlencode 'query=Market Capitalization > 500 AND Price to Earning < 15'
```

The `query` value is limited to 4,000 characters. Only one `query` parameter is accepted; other query parameters are rejected.

Supported syntax:

- Comparisons: `>`, `<`, `>=`, `<=`, `=`
- Arithmetic: `+`, `-`, `*`, `/`
- Grouping: parentheses, such as `(Price to Earning < 15 OR Price to book value < 2) AND Debt to equity < 1`
- Logic: `AND`, `OR`

## Use screening from an agent

Screening evaluates the company universe; it does not take `symbol` and does not need a preceding company-search call. Choose this operation when a user asks to find companies that satisfy financial criteria. If a requested threshold, time period, or unit is unclear, ask for it instead of assuming. Translate each criterion into an expression using exact labels from the supported-measures catalog below. Combine conditions with `AND` when all must match. Use parentheses to make mixed `AND`/`OR` logic explicit. Do not silently replace an unavailable measure with a similar one.

Examples:

```text
# All conditions must match
Market Capitalization > 500 AND Price to Earning < 15 AND Return on capital employed > 22%

# Either valuation criterion may match, and debt must remain below the limit
(Price to Earning < 15 OR Price to book value < 2) AND Debt to equity < 1

# Arithmetic can combine supported measures
(Sales growth 3Years + Profit growth 3Years) / 2 > 15
```

### MCP

Call `screen_companies` with the complete expression as `query`:

```json
{
  "query": "Market Capitalization > 500 AND Price to Earning < 15"
}
```

The MCP tool automatically URL-encodes the value and returns the API response as JSON text. Do not pass a company symbol or split the expression across multiple tool arguments.

### CLI

The CLI command generated from the API operation is `get_api_v1_screen`. Quote the complete expression so the shell passes it as one `--query` value:

```bash
legerline get_api_v1_screen --query 'Market Capitalization > 500 AND Price to Earning < 15'
```

The CLI handles URL encoding and writes the structured JSON response to stdout. See the [public MCP/CLI quickstart](https://stock-market-api.auenkr.com/#mcp) for setup and access requirements.

### Interpret results

- `count` is the number of returned rows. Treat it as the size of this response, not proof that the data source has complete coverage of every listed company.
- `columns` lists the source's displayed columns. Each row in `data` uses those visible column labels as keys and also includes `Symbol`, the company URL path for follow-up company tools.
- Blank or unavailable values are `null`; preserve them as unknown rather than treating them as zero.
- The measure's displayed unit controls the threshold. Market capitalization is displayed in INR crores; percentage measures use the displayed percent convention. Don't convert a threshold unless the user specifies a different unit.
- MCP and CLI call the deployed Rust API without credentials.

The [interactive API reference](https://stock-market-api.auenkr.com/#api-reference) documents the query field. The supported measures are listed below.

## Response format

The response includes the original `query`, the number of returned rows in `count`, source column names in `columns`, and matching company rows in `data`. Each row uses the displayed column names as keys. The serial-number column is named `Order`; the visible column label is used without a separate unit suffix (for example, `CMP` from `CMP Rs.`). `Symbol` is added from the company link in the HTML. Numeric cells are JSON numbers, blank cells are `null`, and missing cells are included as `null`. This illustrative response shows the shape; values and selected columns depend on the query:

```json
{
  "query": "Market Capitalization > 500 AND Price to Earning < 15",
  "count": 1,
  "columns": ["Order", "Company", "CMP", "P/E"],
  "data": [
    {
      "Order": 1,
      "Company": "Example Industries",
      "Symbol": "/company/EXAMPLE/",
      "CMP": 196.75,
      "P/E": 12.4
    }
  ]
}
```

The results contain the rows returned for that query; they are not a promise of a complete universe or exhaustive data coverage.

## Supported ratio measures

Use these labels exactly as written. The ratio gallery also contains statement and price fields described in the next section. Historical, average, and preceding-period measures are available when present in the gallery.

### Ratios

**Valuation and company size:** `Market Capitalization`; `Price to Earning`; `Dividend yield`; `Price to book value`; `Industry PE`; `Industry PBV`; `Enterprise Value`; `Price to Quarterly Earning`; `Book value`; `Earnings yield`; `Historical PE 3Years`; `Historical PE 5Years`; `Historical PE 7Years`; `Historical PE 10Years`; `Historical PBV 3Years`; `Historical PBV 5Years`; `Historical PBV 7Years`; `Historical PBV 10Years`.

**Returns, profitability, and growth:** `Return on assets`; `Return on equity`; `Return on invested capital`; `Return on capital employed preceding year`; `Return on assets preceding year`; `Return on equity preceding year`; `Average return on equity 3Years`; `Average return on equity 5Years`; `Average return on equity 7Years`; `Average return on equity 10Years`; `Return on equity 5years growth`; `Return on assets 3years`; `Return on assets 5years`; `Average return on capital employed 3Years`; `Average return on capital employed 5Years`; `Average return on capital employed 7Years`; `Average return on capital employed 10Years`; `Median return on capital employed 5Years`; `Median return on capital employed 10Years`; `Average return on invested capital 3Years`; `Average return on invested capital 5Years`; `OPM 5Year`; `OPM 10Year`; `Average 5years dividend`; `Average dividend payout 3years`.

**Debt, liquidity, and operating efficiency:** `Debt to equity`; `Inventory turnover ratio`; `Quick ratio`; `Asset Turnover Ratio`; `Financial leverage`; `Debtor days`; `Working Capital Days`; `Earning Power`; `Graham Number`; `Cash Conversion Cycle`; `Days Payable Outstanding`; `Days Receivable Outstanding`; `Days Inventory Outstanding`; `Inventory turnover ratio 3Years back`; `Inventory turnover ratio 5Years back`; `Inventory turnover ratio 7Years back`; `Inventory turnover ratio 10Years back`; `Average debtor days 3years`; `Debtor days 3years back`; `Debtor days 5years back`; `Average Working Capital Days 3years`.

**Ownership and other reported measures:** `Promoter holding`; `Pledged percentage`; `Number of equity shares`; `Number of Shareholders`; `Unpledged promoter holding`; `Public holding`; `FII holding`; `Change in FII holding`; `DII holding`; `Change in DII holding`; `Number of Shareholders preceding quarter`; `Number of Shareholders 1year back`; `Number of equity shares 10years back`; `Book value preceding year`; `Book value 3years back`; `Book value 5years back`; `Book value 10years back`; `Exports percentage`; `Exports percentage 3Years back`; `Exports percentage 5Years back`; `Change in FII holding 3Years`; `Change in DII holding 3Years`; `Credit rating`; `Piotroski score`; `G Factor`.

**Market capitalization history:** `Market Capitalization 3years back`; `Market Capitalization 5years back`; `Market Capitalization 7years back`; `Market Capitalization 10years back`.

### User-created ratios

`Price to Sales`; `Price to Free Cash Flow`; `EVEBITDA`; `Current ratio`; `Interest Coverage Ratio`; `PEG Ratio`; `Working Capital to Sales ratio`; `QoQ Profits`; `QoQ Sales`; `Net worth`; `Market Cap to Sales`; `Interest Coverage`; `Enterprise Value to EBIT`; `Debt Capacity`; `Debt To Profit`; `Total Capital Employed`; `CROIC`; `debtplus`; `Leverage`; `Dividend Payout`; `Intrinsic Value`; `cash debt contingent liabilities by mcap`; `Cash by market cap`; `52w Index`; `Down from 52w high`; `Up from 52w low`; `From 52w high`; `Mkt Cap To Debt Cap`; `Dividend Payout Ratio`; `Graham`; `Price to Cash Flow`; `ROCE3yr avg`; `PB X PE`; `NCAVPS`; `Market Capt to Cash Flow`; `Altman Z Score`; `Market cap to quarterly profit`.

### Other gallery fields

The gallery also provides measures from annual and quarterly profit and loss, balance sheet, cash flow, and price sections. It includes preceding-period and historical variants. These labels can be used in expressions when they appear in the gallery. The catalog above records the full Ratios and User-created ratios groups observed during review; gallery labels may change as new fields are added or removed.
