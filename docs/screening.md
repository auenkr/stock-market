# Company screening

`GET /api/v1/screen?query=...` runs a company screening expression. The `/v1/screen` alias is available. Send an API key using `X-API-Key`. The endpoint requires Personal or Professional access.

```http
GET /api/v1/screen?query=Market%20capitalization%20%3E%20500%20AND%20Price%20to%20earning%20%3C%2015
X-API-Key: YOUR_API_KEY
```

Expressions support measure names, comparison operators (`>`, `<`, `>=`, `<=`, `=`), arithmetic (`+`, `-`, `*`, `/`), parentheses, and boolean `AND` / `OR`. Use the exact measure name shown in the ratio gallery. Query strings are limited to 4,000 characters. Spaces and operators should be URL encoded by the HTTP client.

The response contains the original query, `count`, the selected `columns`, and `data`, an array of matching company objects. Each company object is keyed by the displayed column name and includes `symbol` when available. Numeric table cells are JSON numbers; blank cells are `null`; other cells are strings. The returned result contains only the rows made available for that query.

## Ratio gallery measures

The gallery groups measures into Most Used, Annual P&L, Quarter P&L, Balance Sheet, Cash Flow, Ratios, and Price. It also offers preceding-period and historical measures within those groups. The following two lists include all measures in the Ratios and user-created ratio groups observed in the gallery; measures can occur in multiple groups.

### Ratios

Market Capitalization; Price to Earning; Dividend yield; Price to book value; Return on assets; Debt to equity; Return on equity; Promoter holding; Earnings yield; Pledged percentage; Industry PE; Enterprise Value; Number of equity shares; Price to Quarterly Earning; Book value; Inventory turnover ratio; Quick ratio; Exports percentage; Piotroski score; G Factor; Asset Turnover Ratio; Financial leverage; Number of Shareholders; Unpledged promoter holding; Return on invested capital; Debtor days; Industry PBV; Credit rating; Working Capital Days; Earning Power; Graham Number; Cash Conversion Cycle; Days Payable Outstanding; Days Receivable Outstanding; Days Inventory Outstanding; Public holding; FII holding; Change in FII holding; DII holding; Change in DII holding; Book value preceding year; Return on capital employed preceding year; Return on assets preceding year; Return on equity preceding year; Number of Shareholders preceding quarter; Average return on equity 5Years; Average return on equity 3Years; Number of equity shares 10years back; Book value 3years back; Book value 5years back; Book value 10years back; Inventory turnover ratio 3Years back; Inventory turnover ratio 5Years back; Inventory turnover ratio 7Years back; Inventory turnover ratio 10Years back; Exports percentage 3Years back; Exports percentage 5Years back; Average 5years dividend; Average return on capital employed 3Years; Average return on capital employed 5Years; Average return on capital employed 7Years; Average return on capital employed 10Years; Median return on capital employed 5Years; Median return on capital employed 10Years; Average return on equity 10Years; Average return on equity 7Years; Return on equity 5years growth; OPM 5Year; OPM 10Year; Number of Shareholders 1year back; Average dividend payout 3years; Average return on invested capital 3Years; Average return on invested capital 5Years; Average debtor days 3years; Debtor days 3years back; Debtor days 5years back; Return on assets 5years; Return on assets 3years; Historical PE 3Years; Historical PE 10Years; Historical PE 7Years; Historical PE 5Years; Historical PBV 3Years; Historical PBV 5Years; Historical PBV 7Years; Historical PBV 10Years; Market Capitalization 3years back; Market Capitalization 5years back; Market Capitalization 7years back; Market Capitalization 10years back; Average Working Capital Days 3years; Change in FII holding 3Years; Change in DII holding 3Years.

### User-created ratios

Price to Sales; Price to Free Cash Flow; EVEBITDA; Current ratio; Interest Coverage Ratio; PEG Ratio; Working Capital to Sales ratio; QoQ Profits; QoQ Sales; Net worth; Market Cap to Sales; Interest Coverage; Enterprise Value to EBIT; Debt Capacity; Debt To Profit; Total Capital Employed; CROIC; debtplus; Leverage; Dividend Payout; Intrinsic Value; cash debt contingent liabilities by mcap; Cash by market cap; 52w Index; Down from 52w high; Up from 52w low; From 52w high; Mkt Cap To Debt Cap; Dividend Payout Ratio; Graham; Price to Cash Flow; ROCE3yr avg; PB X PE; NCAVPS; Market Capt to Cash Flow; Altman Z Score; Market cap to quarterly profit.

The gallery also contains statement and price fields used in expressions. Categories and individual measures can change as the source adds or removes them; this list records the complete ratio and user-created ratio groups found during the current review.
