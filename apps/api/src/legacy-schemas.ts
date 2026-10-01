import type { Schema } from "./endpoint-catalog.js";

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema): Schema => ({ type: "array", items });
const string: Schema = { type: "string" };
const number: Schema = { type: "number" };
const nullableNumber: Schema = { type: "number", nullable: true };
const date: Schema = { type: "string", format: "date-time", nullable: true };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required });
const values = (names: string[], name = "LegacyNumber") => Object.fromEntries(names.map((field) => [field, ref(name)]));
const statement = (plain: string[], detailed: string[] = [], extra: Record<string, Schema> = {}) => object({ timePeriod: string, ...values(plain), ...values(detailed, "LegacyDetail"), ...extra }, ["timePeriod"]);

// Preserve the original scraper's spelling, units and optional source rows.
// Compatibility resources use different schemas and null for missing values.
export const legacySchemas: Record<string, Schema> = {
  LegacyNumber: {
    ...object({ amount: number, baseValue: { type: "string", enum: ["one", "ten", "hundred", "thousand", "lakh", "crore", "percent", "ratio", "none"] } }),
    description: "Read amount with baseValue. crore means INR crores; percent means percentage points. This legacy parser can return zero for a blank or unparseable source cell; zero does not establish a reported value.",
  },
  LegacyDetail: object({ value: ref("LegacyNumber"), other: { type: "object", additionalProperties: ref("LegacyNumber") } }),
  LegacyProfitLoss: statement(["operatingProfit", "OPM", "interest", "depreciation", "profitBeforeTax", "tax", "EPS"], ["sales", "expenses", "otherIncome", "netProfit"], { sourceUrl: string }),
  LegacyBalanceSheet: statement(["equityCapital", "reservers", "totalLiabilities", "CWIP", "investments", "totalAssets"], ["borrowings", "otherLiabilities", "fiexedAssets", "otherAssets"]),
  LegacyCashFlow: statement(["netCashFlow"], ["operatingActivities", "investingActivities", "financingActivities"]),
  LegacyRatios: statement(["debtorDays", "inventoryDays", "daysPayable", "cashConversionCycle", "workingCapitalTurnover", "ROCE"]),
  LegacyShareholding: statement(["noOfShareHolders"], ["promoters", "FIIS", "DIIS", "government", "public"]),
  LegacyPeer: object({ sector: string, name: string, ...values(["currentPrice", "stockPE", "marketCap", "dividendYield", "netProfitLatestQuarter", "YOYQuarterlyProfitGrowth", "salesLatestQuarter", "YOYQuarterlySalesGrowth", "ROCE"]) }),
  LegacyCompanyData: object({
    refId: string, name: string, url: string, about: string, keyPoints: string,
    timeStamp: { type: "string", format: "date-time", description: "Scrape timestamp; a cached response retains its original timestamp." }, skip: { type: "boolean" },
    summary: object({ ...values(["marketCap", "currentPrice", "high", "low", "stockPE", "bookValue", "dividendYield", "roce", "roe", "faceValue"]), pros: array(string), cons: array(string) }, ["pros", "cons"]),
    peerCompanies: array(ref("LegacyPeer")), quarterlyResultStatements: array(ref("LegacyProfitLoss")), profitAndLossStatements: array(ref("LegacyProfitLoss")),
    balanceSheetStatements: array(ref("LegacyBalanceSheet")), cashFlowStatements: array(ref("LegacyCashFlow")), ratioStatements: array(ref("LegacyRatios")), shareholdingPatternStatements: array(ref("LegacyShareholding")),
    metrics: { ...array({}), maxItems: 0, description: "Always empty on public API routes; market-price history downloads are disabled." },
    news: { ...array(object(Object.fromEntries(["link_src", "link_track", "pdt_dis_nm", "name", "sc_id", "stock_name"].map((field) => [field, string])), [])), description: "Supplementary Moneycontrol search results; empty if the optional source fails." },
  }),
  LegacyDirectoryCompany: object({ name: string, url: { type: "string", example: "/company/id/1286218/" }, ...Object.fromEntries(["cmp", "pe", "marketCap", "divYld", "npQtr", "qtrProfitVar", "salesQtr", "qtrSalesVar", "roce"].map((field) => [field, number])) }),
  LegacySubscriptionRow: { ...object({ shares_offered: nullableNumber, bids_received: nullableNumber }), nullable: true },
  LegacyIPO: object({
    id: string, name: string, url: string, exchanges: array(object({ exchange: string, url: string })),
    subscription_period: object({ start_date: date, end_date: date }), price: object({ lower_band: nullableNumber, upper_band: nullableNumber, is_fixed_price: { type: "boolean" } }),
    listing_date: date, market_cap_cr: number, pe: number, roce_percentage: number, gmp_percentage: nullableNumber,
    subscription: object({ total_times: nullableNumber, breakdown: { ...object({ institutional: ref("LegacySubscriptionRow"), retail: ref("LegacySubscriptionRow"), total: ref("LegacySubscriptionRow"), non_institutional: { ...object({ shares_offered: nullableNumber, bids_received: nullableNumber, above_10_lakh: ref("LegacySubscriptionRow"), from_2_to_10_lakh: ref("LegacySubscriptionRow") }, ["shares_offered", "bids_received"]), nullable: true } }), nullable: true } }),
  }),
};

const companyPagination: Record<string, Schema> = {
  currentPage: { type: "integer", minimum: 1 },
  limit: { type: "integer", example: 100 },
  count: { type: "integer", minimum: 0, description: "Number of companies returned on this page." },
  isNextPageAvailable: { type: "boolean", description: "Whether the source links to a later page." },
  nextPage: { type: "integer", minimum: 1, nullable: true },
  previousPage: { type: "integer", minimum: 1, nullable: true },
};
const directory = array(ref("LegacyDirectoryCompany"));
const ipos = array(ref("LegacyIPO"));
const search = array({ type: "object", additionalProperties: true });
export const legacyResponses: Record<string, Schema> = {
  "list-of-company": object({ meta: object(companyPagination), data: directory }),
  "list-of-ipo": object({ data: ipos, ipos }),
  "company-search": object({ data: search, results: search }),
  "company-data": object({ data: ref("LegacyCompanyData"), companyData: ref("LegacyCompanyData") }),
  extract: object({ data: array({ anyOf: ["LegacyProfitLoss", "LegacyBalanceSheet", "LegacyCashFlow", "LegacyRatios", "LegacyShareholding", "LegacyPeer"].map(ref), description: "Rows depend on the selected type. Source fields may be omitted, so variants can overlap." }), meta: object({ endpoint: string, type: { type: "string", enum: ["quarterly", "profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding", "peers"] }, cached: { type: "boolean" } }) }),
};
