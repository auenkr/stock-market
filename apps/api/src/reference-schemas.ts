import type { Schema } from "./endpoint-catalog.js";

const text: Schema = { type: "string", nullable: true };
const number: Schema = { type: "number", nullable: true };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required });
const array = (items: Schema): Schema => ({ type: "array", items });
const fields = (names: string[], schema = number) => Object.fromEntries(names.map((name) => [name, schema]));
const periods: Schema = { type: "object", additionalProperties: number };
const row = (names: string[]): Schema => ({ ...object({ header: text, year: number, ...fields(names) }, ["header", "year"]), additionalProperties: true });
const envelope = (key: string, value: Schema): Schema => object({ symbol: { type: "string" }, [key]: value });
const financialRows = ["EPS", "adjustedEquityShareCapital", "adjustedFaceValue", "changesInInventories", "costOfMaterialsConsumed", "costofGoodsSold", "currentTax", "deferredTax", "depreciationAndAmortisation", "dilutedSharesOutstanding", "employeeBenefitExpense", "exceptionalItemsBeforeTax", "expenses", "extraordinaryItems", "financeCosts", "income", "nonControllingInterests", "otherExpenses", "otherIncome", "profitBeforeTax", "profitLossForEPS", "profitLossForPeriod", "profitOrLossAttributableToOwners", "profitOrLossOfAssociates", "purchasesOfStockInTrade", "revenueFromOperations", "taxExpense"];
const basicMetrics = ["adjustedEquityShareCapital", "adjustedFaceValue", "costOfGoodsSold", "dilutedSharesOutstanding", "ebit", "ebitda", "grossIncome", "operatingExpenses", "operatingProfit", "operatingRevenue", "operatingMargin", "salesPerShare", "sharesOutstanding", "tax"];
const balanceFields = ["totalEquity", "equityCapital", "reserves", "liabilities", "equityAndLiabilities", "assets", "capitalWorkInProgress", "fixedAssets", "investments", "otherAssets", "inventories", "tradeReceivables", "cashAndCashEquivalents", "tradePayables", "longTermBorrowings", "shortTermBorrowings", "currentAssets", "noncurrentAssets", "currentLiabilities", "noncurrentLiabilities"];
const cashFields = ["cashFlowsFromOperatingActivities", "cashFlowsFromInvestingActivities", "cashFlowsFromFinancingActivities", "netCashFlow", "freeCashFlow"];
const profitLoss = row([...financialRows, ...basicMetrics]);
const ratio = row(["dividendPayout", "ebitMargin", "ebitdaMargin", "effectiveTaxRate", "grossMargin", "netMargin", "operatingMargin", "preTaxMargin", "retentionRatio", "returnOnAsset", "returnOnCapital", "returnOnEquity", "returnOnTangibleAssets"]);
const reportedMetrics = array(object({ header: text, values: periods }));
const ownershipFields = ["convertibleSecWarrants", "dematEquityShares", "differentialVotingRights", "indianShareholders", "lockedInShares", "lockedInSharesPct", "outstandingConvertibleSecurities", "outstandingDepositoryRcpts", "pANShareholder", "paidUpEquityShares", "partlyPaidUpEquity", "pledgedShares", "pledgedSharesPct", "promoterShareholding", "sameClassVotingRights", "shareholdingPct", "shareholdingPctConv", "subCategory1Shares", "subCategory2Shares", "subCategory3Shares", "totalShareholders", "totalShares", "totalVotingRights", "totalVotingRightsPct", "warrants"];
const ownershipRow = object({ ...fields(ownershipFields), ...fields(["bankName", "categoryOrMoreThan1Pct", "foreignShareholders", "group", "institutions", "otherNonInstitutions", "sh_axis", "sh_index", "shareholder_name", "sub_group", "typeDepositoryRcpts"], text) });
const document = object({ title: text, url: { type: "string" }, date: { ...text, format: "date" }, year: number });
const corporateActionRow = object({ action: text, adj_amount: number, amount: number, dividend_type: text, ex_date: text, subject: text, symbol: text, timestamp_unix: number });
const priceRatioFields = fields(["pb", "pe", "pfcf", "ps", "ptb"]);

export const responseSchemas: Record<string, Schema> = {
  company_profile: object({ ...fields(["bse_code", "description", "industry", "macro_sector", "name", "nse_code", "sector", "sub_industry", "symbol", "website"], text), market_cap: number }),
  basic_financials: object({ symbol: { type: "string" }, summary: periods, about: { type: "string" }, keyPoints: { type: "string" },
    basicFinance: object({ change: text, ...fields(["high52", "low52", "market_cap", "price", "shares", "volume"]), tradetime: text }),
    analysis: object({ pros: array({ type: "string" }), cons: array({ type: "string" }) }) }),
  company_documents: envelope("documents", object(Object.fromEntries(["annualReports", "announcements", "creditRatings", "callTranscripts", "presentations", "other"].map((group) => [group, array(document)])))),
  peer_comparison: envelope("peers", array(object({ symbol: { type: "string" }, name: text, ...fields(["currentPrice", "stockPE", "marketCap", "dividendYield", "netProfitLatestQuarter", "YOYQuarterlyProfitGrowth", "salesLatestQuarter", "YOYQuarterlySalesGrowth", "ROCE"]) }))),
  quarterly_profit_loss: envelope("financials", array(profitLoss)),
  profit_loss: envelope("financials", array(profitLoss)),
  balance_sheet: envelope("financials", array(row(balanceFields))),
  cash_flow: envelope("financials", array(row(cashFields))),
  ratios: object({ symbol: { type: "string" }, ratios: array(ratio), metrics: reportedMetrics }),
  shareholding_pattern: object({ columns: array(text), company_name: text, rows: array(object({ catagory: text, data: periods, name: text, shareholders: array(object({ data: periods, name: text })) })), status: text, stock_symbol: text }),
  // Supporting row schemas are used by the statement mapper, not separate routes.
  statement_fields: envelope("financials", array(row(financialRows))),
  profit_loss_metrics: envelope("basic_financials", array(row(basicMetrics))),
  daily_price_ratios: envelope("price_ratios", array(object({ ...priceRatioFields, quote_date: text }))),
  annual_price_ratios: envelope("price_ratios", array(object({ ...priceRatioFields, header: text, average_price: number, year: number }))),
  shareholdings_summary: object({ symbol: text, period: text, summary: array(object({ header: text, ...fields(ownershipFields) })) }),
  shareholdings_distribution: object({ symbol: text, period: text, distributions: array(object({ date_header: text, distributions: array(object({ group: text, data: object(fields(["dematEquityShares", "paidUpEquityShares", "sameClassVotingRights", "shareholdingPct", "shareholdingPctConv", "subCategory1Shares", "subCategory2Shares", "subCategory3Shares", "totalShareholders", "totalShares", "totalVotingRights", "totalVotingRightsPct"])) })) })) }),
  shareholdings_ownership_current: object({ symbol: text, quarter: text, ownerships: array(ownershipRow) }),
  shareholdings_ownership_history: object({ symbol: text, period: text, ownership_histories: array(object({ header: text, data: array(ownershipRow) })) }),
  corporate_actions_all: array(corporateActionRow),
  corporate_actions: envelope("actions", array(corporateActionRow)),
  dividend: envelope("dividend", array(object({ adj_amount: number, amount: number, date: text, dividend_type: text, subject: text }))),
  results_calendar: array(object({ company_name: text, expected_result_date: text, symbol: text })),
  index_market_price_historical: object({ index_symbol: text, rows: array(object({ index_symbol: text, quote_date: text, ...fields(["change_pct", "close_price", "high_price", "low_price", "open_price", "points_change", "timestamp", "turnover", "volume"]) })) }),
  index_valuation_historical: object({ index_symbol: text, rows: array(object({ quote_date: text, ...fields(["div_yield", "pb", "pe", "timestamp"]) })) }),
  commodity_price: array(object({ date_header: text, timestamp: number, value: number })),
};
