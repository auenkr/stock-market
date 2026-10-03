import { sourceGet, type SourceOptions } from "../utils/source.js";
import { errorDetails, log } from "@stock-market/common/logger";
import { DELAY_BETWEEN_API_REQUEST } from "../utils/constant.js";
import * as cheerio from "cheerio";
import { getCompanyMetrics, type CompanyMetricDataType } from "./getCompanyMetric.js";

export interface NewsItem {
  link_src: string;
  link_track: string;
  pdt_dis_nm: string;
  name: string;
  sc_id: string;
  stock_name: string;
}

// ***************************************************************
//                        ALL DATA TYPES
// ***************************************************************

export type BaseValueEnum =
  | "one"
  | "ten"
  | "hundred"
  | "thousand"
  | "lakh"
  | "crore"
  | "percent"
  | "ratio"
  | "none";

export type NumberDataType = {
  amount: number; // 1488.50
  baseValue: BaseValueEnum; // hundred, thousand, lakh, crore, percent, ratio etc.
};

export type CompanyDataType = {
  refId: string;
  name: string;
  url: string;
  about: string;
  keyPoints: string;
  timeStamp: string;
  skip: boolean;
  summary: CompanySummaryDataType;
  peerCompanies: CompanyPeerCompaniesDataType[];
  quarterlyResultStatements: QuarterlyResultStatementType[];
  profitAndLossStatements: ProfitAndLossStatementType[];
  balanceSheetStatements: BalanceSheetStatementType[];
  cashFlowStatements: CashFlowStatementType[];
  ratioStatements: RatioStatementType[];
  shareholdingPatternStatements: ShareholdingPatternStatementType[];
  metrics: CompanyMetricDataType[];
  news: NewsItem[];
};

type CompanySummaryDataType = {
  marketCap: NumberDataType;
  currentPrice: NumberDataType;
  high: NumberDataType;
  low: NumberDataType;
  stockPE: NumberDataType;
  bookValue: NumberDataType;
  dividendYield: NumberDataType; // in percentage
  roce: NumberDataType; // in percentage
  roe: NumberDataType; // in percentage
  faceValue: NumberDataType;
  // enterpriseValue: NumberDataType; // Can be derived from extracted data
  pros: string[];
  cons: string[];
};

export type CompanyPeerCompaniesDataType = {
  symbol: string;
  sector: string;
  name: string;
  currentPrice: NumberDataType;
  stockPE: NumberDataType; // ratio
  marketCap: NumberDataType;
  dividendYield: NumberDataType; // in percentage
  netProfitLatestQuarter: NumberDataType;
  YOYQuarterlyProfitGrowth: NumberDataType; // in percentage
  salesLatestQuarter: NumberDataType;
  YOYQuarterlySalesGrowth: NumberDataType; // in percentage
  ROCE: NumberDataType; // in percentage
};

export type QuarterlyResultStatementType = {
  timePeriod: string; // Date
  sales: DetailStatementDataType;
  expenses: DetailStatementDataType;
  operatingProfit: NumberDataType;
  OPM: NumberDataType; // in percentage
  otherIncome: DetailStatementDataType;
  interest: NumberDataType;
  depreciation: NumberDataType;
  profitBeforeTax: NumberDataType;
  tax: NumberDataType; // in percentage
  netProfit: DetailStatementDataType;
  EPS: NumberDataType;
  sourceUrl: string;
};

export type DetailStatementDataType = {
  value: NumberDataType;
  other: Record<string, NumberDataType>;
};

export type ProfitAndLossStatementType = QuarterlyResultStatementType;

export type BalanceSheetStatementType = {
  timePeriod: string; // Date
  equityCapital: NumberDataType;
  reservers: NumberDataType;
  borrowings: DetailStatementDataType;
  otherLiabilities: DetailStatementDataType;
  totalLiabilities: NumberDataType;
  fiexedAssets: DetailStatementDataType;
  CWIP: NumberDataType;
  investments: NumberDataType;
  otherAssets: DetailStatementDataType;
  totalAssets: NumberDataType;
};

export type CashFlowStatementType = {
  timePeriod: string; // Date:
  operatingActivities: DetailStatementDataType;
  investingActivities: DetailStatementDataType;
  financingActivities: DetailStatementDataType;
  netCashFlow: NumberDataType;
};

export type RatioStatementType = {
  timePeriod: string; // Date
  debtorDays: NumberDataType;
  inventoryDays: NumberDataType;
  daysPayable: NumberDataType;
  cashConversionCycle: NumberDataType;
  workingCapitalTurnover: NumberDataType;
  ROCE: NumberDataType;
};

export type ShareholdingPatternStatementType = {
  timePeriod: string;
  promoters: DetailStatementDataType;
  FIIS: DetailStatementDataType;
  DIIS: DetailStatementDataType;
  public: DetailStatementDataType;
  noOfShareHolders: NumberDataType;
};

// ***************************************************************
//                        HELPER FUNCTIONS
// ***************************************************************

/**
 * Parses a string value into a NumberDataType object.
 * e.g., "1,234.5 Cr." => { amount: 1234.5, baseValue: "crore" }
 * e.g., "50 %" => { amount: 50, baseValue: "percent" }
 */
export function parseNumberData(
  value: string | undefined | null,
  base: BaseValueEnum = "none"
): NumberDataType {
  if (!value || value.trim() === "") {
    return { amount: 0, baseValue: base };
  }

  let cleanValue = value.replace(/,/g, "").trim();
  let baseValue: BaseValueEnum = base;

  if (cleanValue.endsWith("%")) {
    baseValue = "percent";
    cleanValue = cleanValue.replace("%", "").trim();
  } else if (cleanValue.toLowerCase().includes("cr")) {
    baseValue = "crore";
    cleanValue = cleanValue.replace(/cr\./i, "").trim();
  }

  // remove any other non-numeric characters (like currency symbols)
  cleanValue = cleanValue.replace(/[^\d.-]/g, "");

  const amount = parseFloat(cleanValue);

  return {
    amount: isNaN(amount) ? 0 : amount,
    baseValue: baseValue,
  };
}

/**
 * Parses a string value into a DetailStatementDataType object.
 */
function parseDetailData(
  value: string | undefined | null,
  base: BaseValueEnum = "hundred",
  detailDataMap: Map<string, Map<string, string>> | undefined,
  timePeriod: string | undefined
): DetailStatementDataType {
  const result: DetailStatementDataType = {
    value: parseNumberData(value, base),
    other: {},
  };

  if (detailDataMap && timePeriod) {
    const allKeys = Array.from(detailDataMap.keys());
    const dataRecords: Record<string, NumberDataType> = {};
    allKeys.forEach((key) => {
      const data = detailDataMap.get(key)?.get(timePeriod);
      dataRecords[key] = parseNumberData(data, base);
    });
    result.other = dataRecords;
  }
  return result;
}

// ***************************************************************
//                        EXTRACTION LOGIC
// ***************************************************************

/**
 * Extracts all financial statement tables which share a common structure.
 * @param $ - Cheerio instance
 * @param sectionId - The ID of the section to process (e.g., #quarters)
 * @param rowToFieldMap - A map to convert table row text to object keys
 * @param detailFields - A set of fields that are detail fields and need to be parsed as DetailStatementDataType
 * @returns An array of statement objects
 */
async function extractFinancialTable<T>(
  $: cheerio.CheerioAPI,
  sectionId: string,
  rowToFieldMap: Map<string, string>,
  detailFields: Set<string>,
  consolidated = false,
  source: SourceOptions = {}
): Promise<T[]> {
  const table = $(`${sectionId} table`);
  if (table.length === 0) return [];

  const headers: string[] = [];
  table.find("thead th").each((i, el) => {
    if (i > 0) {
      // Skip first empty header
      headers.push($(el).text().trim());
    }
  });

  // Initialize an array of objects, one for each time period (column)
  const statements: any[] = headers.map((header) => ({ timePeriod: header }));

  // Get out the detail fields from the statements
  const refId = $("#company-info").attr("data-company-id") as string;

  const allDataMap: Map<string, Map<string, Map<string, string>>> = new Map();

  for (const field of detailFields) {
    const url = `/api/company/${refId}/schedules/?parent=${field}&section=${sectionId.split("#")[1]
      }&consolidated=${consolidated ? "true" : ""}`;

    const response = await sourceGet(url, source);
    const data = response.data;
    // deplay to avoid rate limiting
    await new Promise((resolve) =>
      setTimeout(resolve, DELAY_BETWEEN_API_REQUEST)
    );

    // Convert data from object to map
    const dataMap = new Map<string, Map<string, string>>();
    Object.entries(data).forEach(([key, value]) => {
      const itemMap = new Map<string, string>();
      Object.entries(value as Record<string, string>).forEach(
        ([key, value]) => {
          itemMap.set(key, value);
        }
      );
      dataMap.set(key, itemMap);
    });
    allDataMap.set(rowToFieldMap.get(field) as string, dataMap);
  }

  table.find("tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length === 0) return;

    let rowTitle = cells.first().text().trim().replace("+", "").trim();
    const fieldKey = rowToFieldMap.get(rowTitle);

    if (fieldKey) {
      cells.slice(1).each((i, cell) => {
        if (statements[i]) {
          const cellText = $(cell).text().trim();

          // Logic to determine the correct base value for each row type
          const isPercentage = rowTitle.includes("%");
          const isRatio = rowTitle.includes("P/E");
          const isEPS = rowTitle.includes("EPS");
          const isDays = rowTitle.toLowerCase().includes("days");
          const isShareholders = rowTitle.includes("No. of Shareholders");

          let base: BaseValueEnum = "crore"; // Default for financial statements
          if (isPercentage) {
            base = "percent";
          } else if (isRatio) {
            base = "ratio";
          } else if (isEPS || isDays || isShareholders) {
            base = "one";
          }

          // Different types require different parsing
          if (
            [
              "sales",
              "expenses",
              "otherIncome",
              "netProfit",
              "borrowings",
              "otherLiabilities",
              "fiexedAssets",
              "otherAssets",
              "operatingActivities",
              "investingActivities",
              "financingActivities",
              "promoters",
              "FIIS",
              "DIIS",
              "public",
              "government",
            ].includes(fieldKey)
          ) {
            statements[i][fieldKey] = parseDetailData(
              cellText,
              base,
              allDataMap.get(fieldKey),
              statements[i].timePeriod
            );
          } else {
            statements[i][fieldKey] = parseNumberData(cellText, base);
          }
        }
      });
    }
  });

  return statements as T[];
}

// ***************************************************************
//                        MAIN FUNCTION
// ***************************************************************

/**
 * Fetches company data from a given endpoint and parses the HTML to extract financial information.
 * @param endpoint The URL to fetch the data from.
 * @returns A promise that resolves to the structured company data.
 */
export async function GetCompanyData(
  endpoint: string,
  options: SourceOptions & { includeMarketHistory?: boolean } = {}
): Promise<CompanyDataType> {
  try {
    // 1. Fetch HTML from the endpoint
    const response = await sourceGet<string>(endpoint, options);
    const html = response.data;

    // 2. Load HTML into Cheerio for parsing
    const $ = cheerio.load(html);

    // 3. Extract Data
    const refId = $("#company-info").attr("data-company-id") || "";
    const name = $("h1.margin-0.show-from-tablet-landscape").text().trim();
    if (!refId || !name) throw new Error("Source did not return a company page");
    const consolidated = endpoint.includes("/consolidated");
    const url = $('.company-links a[href^="http"]').first().attr("href") || "";
    const about = $(".about p").text().trim();
    const keyPoints = $("div.title:contains('Key Points')")
      .next(".sub.commentary")
      .text()
      .trim();

    // -- Summary Data --
    const summary: Partial<CompanySummaryDataType> = {};
    $("#top-ratios li").each((_, el) => {
      const name = $(el).find(".name").text().trim();
      const value = $(el).find(".value").text().trim();

      switch (name) {
        case "Market Cap":
          summary.marketCap = parseNumberData(value, "crore");
          break;
        case "Current Price":
          summary.currentPrice = parseNumberData(value, "one");
          break;
        case "High / Low":
          const [high, low] = value.split(" / ").map((v) => v.trim());
          summary.high = parseNumberData(high, "one");
          summary.low = parseNumberData(low, "one");
          break;
        case "Stock P/E":
          summary.stockPE = parseNumberData(value, "ratio");
          break;
        case "Book Value":
          summary.bookValue = parseNumberData(value, "one");
          break;
        case "Dividend Yield":
          summary.dividendYield = parseNumberData(value, "percent");
          break;
        case "ROCE":
          summary.roce = parseNumberData(value, "percent");
          break;
        case "ROE":
          summary.roe = parseNumberData(value, "percent");
          break;
        case "Face Value":
          summary.faceValue = parseNumberData(value, "one");
          break;
      }
    });
    summary.pros = $(".pros ul li")
      .map((_, el) => $(el).text().trim())
      .get();
    summary.cons = $(".cons ul li")
      .map((_, el) => $(el).text().trim())
      .get();

    // TODO: Peer Companies
    const peerCompanies = await getPeerCompanies($, options); // TODO: Implement this

    // -- Quarterly Results --
    const quarterlyMap = new Map([
      ["Sales", "sales"],
      ["Revenue", "sales"],
      ["Expenses", "expenses"],
      ["Operating Profit", "operatingProfit"],
      ["Financing Profit", "operatingProfit"],
      ["Financing Margin %", "OPM"],
      ["OPM %", "OPM"],
      ["Other Income", "otherIncome"],
      ["Interest", "interest"],
      ["Depreciation", "depreciation"],
      ["Profit before tax", "profitBeforeTax"],
      ["Tax %", "tax"],
      ["Net Profit", "netProfit"],
      ["EPS in Rs", "EPS"],
    ]);
    const quarterlyDetailFields = new Set<string>([
      "Sales",
      "Expenses",
      "Other Income",
      "Net Profit",
    ]);

    const quarterlyResultStatements =
      await extractFinancialTable<QuarterlyResultStatementType>(
        $,
        "#quarters",
        quarterlyMap,
        quarterlyDetailFields,
        consolidated,
        options
      );
    // Add source URLs
    $("#quarters tbody tr.font-size-14.ink-600 td a").each((i, el) => {
      if (quarterlyResultStatements[i]) {
        quarterlyResultStatements[i].sourceUrl = $(el).attr("href") || "";
      }
    });

    // -- Profit & Loss --
    const profitAndLossDetailFields = quarterlyDetailFields;
    const profitAndLossStatements =
      await extractFinancialTable<ProfitAndLossStatementType>(
        $,
        "#profit-loss",
        quarterlyMap,
        profitAndLossDetailFields,
        consolidated,
        options
      );

    // -- Balance Sheet --
    const balanceSheetMap = new Map([
      ["Equity Capital", "equityCapital"],
      ["Reserves", "reservers"],
      ["Borrowings", "borrowings"],
      ["Borrowing", "borrowings"],
      ["Other Liabilities", "otherLiabilities"],
      ["Total Liabilities", "totalLiabilities"],
      ["Fixed Assets", "fiexedAssets"],
      ["CWIP", "CWIP"],
      ["Investments", "investments"],
      ["Other Assets", "otherAssets"],
      ["Total Assets", "totalAssets"],
    ]);
    const balanceSheetDetailFields = new Set<string>([
      "Borrowings",
      "Other Liabilities",
      "Fixed Assets",
      "Other Assets",
    ]);
    const balanceSheetStatements =
      await extractFinancialTable<BalanceSheetStatementType>(
        $,
        "#balance-sheet",
        balanceSheetMap,
        balanceSheetDetailFields,
        consolidated,
        options
      );

    // -- Cash Flow --
    const cashFlowMap = new Map([
      ["Cash from Operating Activity", "operatingActivities"],
      ["Cash from Investing Activity", "investingActivities"],
      ["Cash from Financing Activity", "financingActivities"],
      ["Net Cash Flow", "netCashFlow"],
    ]);
    const cashFlowDetailFields = new Set<string>([
      "Cash from Operating Activity",
      "Cash from Investing Activity",
      "Cash from Financing Activity",
    ]);
    const cashFlowStatements =
      await extractFinancialTable<CashFlowStatementType>(
        $,
        "#cash-flow",
        cashFlowMap,
        cashFlowDetailFields,
        consolidated,
        options
      );

    // -- Ratios --
    const ratioMap = new Map([
      ["Debtor Days", "debtorDays"],
      ["Inventory Days", "inventoryDays"],
      ["Days Payable", "daysPayable"],
      ["Cash Conversion Cycle", "cashConversionCycle"],
      ["Working Capital Days", "workingCapitalTurnover"], // Assuming this mapping
      ["ROCE %", "ROCE"],
    ]);
    const ratioDetailFields = new Set<string>();
    const ratioStatements = await extractFinancialTable<RatioStatementType>(
      $,
      "#ratios",
      ratioMap,
      ratioDetailFields,
      consolidated,
      options
    );

    // -- Shareholding Pattern --
    const shareHoldingMap = new Map([
      ["Promoters", "promoters"],
      ["FIIs", "FIIS"],
      ["DIIs", "DIIS"],
      ["Government", "government"],
      ["Public", "public"],
      ["No. of Shareholders", "noOfShareHolders"],
    ]);
    // TODO: Different API to hit: /api/3/${refId}/investors/${type}/quarterly/
    const shareholdingPatternDetailFields = new Set<string>([
      // "Promoters",
      // "FIIs",
      // "DIIs",
      // "Public",
      // "Government",
    ]);
    const shareholdingPatternStatements =
      await extractFinancialTable<ShareholdingPatternStatementType>(
        $,
        "#quarterly-shp",
        shareHoldingMap,
        shareholdingPatternDetailFields,
        consolidated,
        options
      );

    // Offline valuation jobs can still opt into price charts. Public API
    // consumers explicitly disable them because market history is out of scope.
    const metricsData = options.includeMarketHistory === false ? [] : await getCompanyMetrics(refId, options);
    if (options.includeMarketHistory !== false) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_API_REQUEST));
    }

    // Assemble the final data object
    const companyData: CompanyDataType = {
      refId,
      name,
      url,
      about,
      keyPoints,
      timeStamp: new Date().toISOString(),
      skip: false,
      summary: summary as CompanySummaryDataType,
      peerCompanies: peerCompanies,
      quarterlyResultStatements,
      profitAndLossStatements,
      balanceSheetStatements,
      cashFlowStatements,
      ratioStatements,
      shareholdingPatternStatements,
      metrics: metricsData,
      news: [],
    };

    // Call new req
    const query = companyData.name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
    try {
      const newsResponse = await sourceGet("https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php", { requestId: options.requestId, cookie: "" }, {
        params: { query, type: 3, format: "json" },
      });
      companyData.news = Array.isArray(newsResponse.data) ? newsResponse.data as NewsItem[] : [];
    } catch (error) {
      log("warn", "company.news.unavailable", { requestId: options.requestId, error: errorDetails(error) });
    }

    return companyData;
  } catch (error) {
    log("error", "company.load.failed", { endpoint, requestId: options.requestId, error: errorDetails(error) });
    throw error;
  }
}

// Get enterprise value
async function getEnterpriseValue(
  $: cheerio.CheerioAPI,
  source: SourceOptions = {}
): Promise<NumberDataType> {
  const warehouseNo = $("#company-info").data("warehouse-id");
  const response = await sourceGet(`/api/company/${warehouseNo}/quick_ratios`, source);
  const html = response.data;
  const $$ = cheerio.load(html);
  // Extract the list item containing "Enterprise Value"
  const evEl = $$('.flex.flex-space-between[data-source="quick-ratio"]')
    .filter(function (idx, el) {
      const label = $$(el).find(".name").text().trim();
      return label === "Enterprise Value";
    })
    .first();

  return parseNumberData(evEl.text().trim(), "crore");
}

async function getPeerCompanies(
  $: cheerio.CheerioAPI,
  source: SourceOptions = {}
): Promise<CompanyPeerCompaniesDataType[]> {
  const warehouseNo = $("#company-info").data("warehouse-id");
  const sectorNode = $('p[class="sub"]').first();
  const sectorValue = sectorNode.text().trim().replace(/\s+/g, " ").trim();

  const response = await sourceGet(`/api/company/${warehouseNo}/peers`, source);
  const html = response.data;
  const $$ = cheerio.load(html);

  const peerCompanies: CompanyPeerCompaniesDataType[] = [];

  // Select all table rows inside the tbody that have the 'data-row-company-id' attribute
  const companyRows = $$("table.data-table tbody tr[data-row-company-id]");

  // Iterate over each selected row
  companyRows.each((index, element) => {
    const row = $$(element);
    const columns = row.find("td");

    // Ensure the row has the expected number of columns to prevent errors
    if (columns.length < 11) {
      return; // Skip this row if it's malformed
    }

    // Extract data from each cell and parse it using the provided helper function
    const companyData: CompanyPeerCompaniesDataType = {
      symbol: $$(columns[1]).find("a[href^='/company/']").attr("href") || "",
      sector: sectorValue, // Sector is not available in the provided HTML
      name: $$(columns[1]).find("a").text().trim(),
      currentPrice: parseNumberData($$(columns[2]).text(), "one"),
      stockPE: parseNumberData($$(columns[3]).text(), "ratio"),
      marketCap: parseNumberData($$(columns[4]).text(), "crore"),
      dividendYield: parseNumberData($$(columns[5]).text(), "percent"),
      netProfitLatestQuarter: parseNumberData($$(columns[6]).text(), "crore"),
      YOYQuarterlyProfitGrowth: parseNumberData(
        $$(columns[7]).text(),
        "percent"
      ),
      salesLatestQuarter: parseNumberData($$(columns[8]).text(), "crore"),
      YOYQuarterlySalesGrowth: parseNumberData(
        $$(columns[9]).text(),
        "percent"
      ),
      ROCE: parseNumberData($$(columns[10]).text(), "percent"),
    };

    peerCompanies.push(companyData);
  });

  return peerCompanies;
}
