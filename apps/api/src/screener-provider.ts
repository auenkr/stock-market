import { getCompanySnapshot, parsePeerComparison, parseAdminRows, parseCorporateActions, sourceDate, numericValue, nextPage, type CompanySnapshot, type FinancialRow } from "@stock-market/scraper/helper/getCompanySnapshot";
import { cachedSourceText, SourceError } from "@stock-market/scraper/utils/source";
import { CacheBusyError, type SourceCache } from "@stock-market/scraper/utils/cache";
import { responseSchemas } from "./reference-schemas.js";
import { errorDetails, log } from "@stock-market/common/logger";
import { validCompanyPath } from "./company-symbol.js";

export class DataError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 429 | 501 | 502 | 503 = 501, public code = "DATASET_UNAVAILABLE") { super(message); }
}

export type DataResult = { body: unknown; headers?: Record<string, string> };
export type DataQuery = Record<string, string>;
export interface DataProvider { execute(resource: string, query: DataQuery): Promise<DataResult> }

const groupDepth: Record<string, number> = { macro_sector: 1, industry: 2, sector: 3, sub_industry: 4 };
const sum = (...xs: (number | null | undefined)[]): number | null => xs.some((x) => x == null) ? null : xs.reduce<number>((a, b) => a + b!, 0);
const divide = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || b === 0 ? null : a / b;
const rupees = (n: number | null | undefined) => n == null ? null : n * 10_000_000;
const year = (header: string) => Number(header.match(/20\d{2}/)?.[0]) || null;
const fullYears = (rows: FinancialRow[]) => rows.filter((r) => /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d{2}$/.test(r.header));
const annualRows = (snapshot: CompanySnapshot, section: string) => {
  const periods = new Set(fullYears(snapshot.tables["profit-loss"] ?? []).map((r) => r.header));
  return fullYears(snapshot.tables[section] ?? []).filter((r) => section === "profit-loss" || periods.has(r.header));
};
function pick(row: FinancialRow, ...names: string[]): number | null {
  for (const name of names) if (row.values[name] != null) return row.values[name]!;
  return null;
}
function blankFields(resource: string, key: string): Record<string, null> {
  const fields = responseSchemas[resource]?.properties?.[key]?.items?.properties ?? {};
  return Object.fromEntries(Object.keys(fields).map((k) => [k, null]));
}

function financials(snapshot: CompanySnapshot, code: string, period: string) {
  if (!["pl", "bs", "cf"].includes(code)) throw new DataError("Invalid statement_code", 400, "INVALID_QUERY");
  if (period === "halfyearly" || period === "ytd" || (period === "ttm" && code !== "pl") || (period === "quarterly" && code !== "pl")) {
    throw new DataError("The current source does not provide this statement and period combination");
  }
  const section = code === "pl" ? (period === "quarterly" ? "quarters" : "profit-loss") : code === "bs" ? "balance-sheet" : "cash-flow";
  let rows = snapshot.tables[section] ?? [];
  rows = period === "ttm" ? rows.filter((r) => r.header === "TTM") : period === "annual" ? annualRows(snapshot, section) : rows;
  return rows.map((row) => {
    const meta = { header: row.header, year: year(row.header) };
    if (code === "pl") {
      const revenue = pick(row, "Sales", "Revenue"); const other = pick(row, "Other Income");
      // The source Expenses row is operating expenses; the API expenses field is
      // total expenses, including finance costs and depreciation.
      const ebit = sum(pick(row, "Profit before tax"), pick(row, "Interest"));
      return { ...blankFields("statement_fields", "financials"), ...blankFields("profit_loss_metrics", "basic_financials"), ...meta,
        revenueFromOperations: rupees(revenue), otherIncome: rupees(other), income: rupees(sum(revenue, other)),
        expenses: rupees(sum(pick(row, "Expenses"), pick(row, "Interest"), pick(row, "Depreciation"))),
        financeCosts: rupees(pick(row, "Interest")), depreciationAndAmortisation: rupees(pick(row, "Depreciation")),
        profitBeforeTax: rupees(pick(row, "Profit before tax")), profitLossForPeriod: rupees(pick(row, "Net Profit")),
        EPS: pick(row, "EPS in Rs"), ebit: rupees(ebit), ebitda: rupees(sum(ebit, pick(row, "Depreciation"))),
        operatingProfit: rupees(pick(row, "Operating Profit", "Financing Profit")), operatingRevenue: rupees(revenue),
        operatingMargin: divide(pick(row, "OPM %", "Financing Margin %"), 100), tax: divide(pick(row, "Tax %"), 100) };
    }
    if (code === "bs") {
      const equity = sum(pick(row, "Equity Capital"), pick(row, "Reserves"));
      return { ...meta, totalEquity: rupees(equity), equityCapital: rupees(pick(row, "Equity Capital")), reserves: rupees(pick(row, "Reserves")),
        liabilities: rupees(sum(pick(row, "Borrowings", "Borrowing"), pick(row, "Other Liabilities"))),
        equityAndLiabilities: rupees(pick(row, "Total Liabilities")), assets: rupees(pick(row, "Total Assets")),
        capitalWorkInProgress: rupees(pick(row, "CWIP")), fixedAssets: rupees(pick(row, "Fixed Assets")), investments: rupees(pick(row, "Investments")), otherAssets: rupees(pick(row, "Other Assets")), inventories: rupees(pick(row, "Inventories")), tradeReceivables: rupees(pick(row, "Trade receivables")), cashAndCashEquivalents: rupees(pick(row, "Cash Equivalents")),
        tradePayables: rupees(pick(row, "Trade Payables")), longTermBorrowings: rupees(pick(row, "Long term Borrowings")), shortTermBorrowings: rupees(pick(row, "Short term Borrowings")),
        currentAssets: null, noncurrentAssets: null, currentLiabilities: null, noncurrentLiabilities: null };
    }
    return { ...meta, cashFlowsFromOperatingActivities: rupees(pick(row, "Cash from Operating Activity")),
      cashFlowsFromInvestingActivities: rupees(pick(row, "Cash from Investing Activity")),
       cashFlowsFromFinancingActivities: rupees(pick(row, "Cash from Financing Activity")), netCashFlow: rupees(pick(row, "Net Cash Flow")), freeCashFlow: rupees(pick(row, "Free Cash Flow")) };
  });
}

function ratios(snapshot: CompanySnapshot, type: string) {
  if (type !== "pr") throw new DataError("Only profitability ratios (ratio_type=pr) have a verified field mapping");
  return fullYears(snapshot.tables["profit-loss"] ?? []).map((row) => {
    const revenue = pick(row, "Sales", "Revenue"), op = pick(row, "Operating Profit", "Financing Profit");
    const pbt = pick(row, "Profit before tax"), interest = pick(row, "Interest"), net = pick(row, "Net Profit");
    const ebit = sum(pbt, interest), income = sum(revenue, pick(row, "Other Income"));
    const dividend = divide(pick(row, "Dividend Payout %"), 100);
    const currentBalance = snapshot.tables["balance-sheet"]?.find((r) => r.header === row.header);
    const previousBalance = snapshot.tables["balance-sheet"]?.find((r) => year(r.header) === (year(row.header) ?? 0) - 1 && r.header.slice(0, 3) === row.header.slice(0, 3));
    const avgAssets = currentBalance && previousBalance ? divide(sum(pick(currentBalance, "Total Assets"), pick(previousBalance, "Total Assets")), 2) : null;
    const avgEquity = currentBalance && previousBalance ? divide(sum(pick(currentBalance, "Equity Capital"), pick(currentBalance, "Reserves"), pick(previousBalance, "Equity Capital"), pick(previousBalance, "Reserves")), 2) : null;
    const ratioRow = snapshot.tables.ratios?.find((r) => r.header === row.header);
    return { ...blankFields("ratios", "ratios"), header: row.header, year: year(row.header),
      dividendPayout: dividend, retentionRatio: dividend == null ? null : 1 - dividend,
      ebitMargin: divide(ebit, revenue), ebitdaMargin: divide(sum(ebit, pick(row, "Depreciation")), revenue),
      effectiveTaxRate: divide(pick(row, "Tax %"), 100), netMargin: divide(net, revenue),
      operatingMargin: divide(op, revenue), preTaxMargin: divide(pbt, income),
      returnOnAsset: divide(net, avgAssets), returnOnEquity: divide(net, avgEquity), returnOnCapital: ratioRow ? divide(pick(ratioRow, "ROCE %"), 100) : null };
  });
}

export class ScreenerProvider implements DataProvider {
  private readonly pending = new Map<string, Promise<string>>();
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly cookie?: string;
  private readonly sourceCache?: SourceCache;
  constructor(options: { baseUrl?: string; cookie?: string; fetcher?: typeof fetch; cache?: SourceCache; cacheEnabled?: boolean } = {}) {
    this.baseUrl = options.baseUrl ?? "https://www.screener.in";
    this.cookie = options.cookie;
    this.sourceCache = options.cacheEnabled !== false ? options.cache : undefined;
    // Workers requires the native fetch receiver to be globalThis, not this provider.
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  async html(path: string, ajax = false): Promise<string> {
    const cacheKey = `${ajax ? "ajax:" : ""}${path}`;
    const pending = this.pending.get(cacheKey); if (pending) return pending;
    if (this.pending.size >= 8) throw new DataError("Source capacity reached; retry later", 503, "SOURCE_BUSY");
    const fetchHtml = async () => {
      let response: Response;
      try { response = await this.fetcher(new URL(path, this.baseUrl), { headers: { Accept: "text/html, application/json", ...(ajax ? { "X-Requested-With": "XMLHttpRequest" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) }, signal: AbortSignal.timeout(15_000) }); }
      catch (error) {
        log("error", "source.fetch.failed", { upstream: new URL(path, this.baseUrl).origin + new URL(path, this.baseUrl).pathname, error: errorDetails(error) });
        throw new DataError("The data source could not be reached", 502, "UPSTREAM_UNAVAILABLE");
      }
      if (!response.ok) log("warn", "source.http.failed", {
        upstream: new URL(path, this.baseUrl).origin + new URL(path, this.baseUrl).pathname,
        upstreamStatus: response.status,
      });
      if (response.status === 404) throw new DataError("Company or source resource not found", 404, "NOT_FOUND");
      if (response.status === 429) throw new DataError("Data source request limit reached; retry later", 503, "SOURCE_RATE_LIMITED");
      if (!response.ok) throw new DataError(`The data source returned HTTP ${response.status}`, 502, "UPSTREAM_UNAVAILABLE");
      if (path.includes("/consolidated/") && response.url && !new URL(response.url).pathname.includes("/consolidated/")) throw new DataError("Consolidated company statements are unavailable", 404, "NOT_FOUND");
      const html = await response.text();
      if (/form[^>]+action=["'][^"']*login/i.test(html) || /<title>[^<]*(?:login|sign in|register)/i.test(html)) throw new DataError("The data source requires authentication", 502, "SOURCE_AUTH_REQUIRED");
      return { text: html, finalUrl: response.url || undefined };
    };
    const request = (async () => {
      try {
        // Company pages are cached as parsed snapshots, never as a second raw
        // entry with a separate expiry. Additional responses share Axios' cache.
        const url = new URL(path, this.baseUrl);
        const companyPage = validCompanyPath(url.pathname);
        const html = companyPage ? (await fetchHtml()).text : (await cachedSourceText(url, { baseUrl: this.baseUrl, cookie: this.cookie, cache: this.sourceCache }, fetchHtml)).value.text;
        return html;
      } catch (error) {
        if (error instanceof SourceError) throw new DataError(error.message, error.status, error.code);
        if (error instanceof CacheBusyError) throw new DataError(error.message, 503, "SOURCE_BUSY");
        throw error;
      }
    })();
    this.pending.set(cacheKey, request);
    try { return await request; } finally { this.pending.delete(cacheKey); }
  }

  private async detailRows(path: string): Promise<Record<string, Record<string, unknown>>> {
    let value: unknown;
    try { value = JSON.parse(await this.html(path, true)); }
    catch (error) { if (error instanceof DataError) throw error; throw new DataError("Source detail rows could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"); }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new DataError("Source detail row format changed", 502, "UPSTREAM_SCHEMA_CHANGED");
    return value as Record<string, Record<string, unknown>>;
  }

  private async expandSchedules(snapshot: CompanySnapshot, section: string, parents: string[]) {
    for (const parent of parents) {
      if (!snapshot.tables[section]?.some((r) => parent in r.values)) continue;
      const params = new URLSearchParams({ parent, section });
      if (snapshot.consolidated) params.set("consolidated", "true");
      const details = await this.detailRows(`/api/company/${snapshot.refId}/schedules/?${params}`);
      for (const [label, data] of Object.entries(details)) for (const row of snapshot.tables[section] ?? []) {
        if (typeof data[row.header] === "string") row.values[label] = numericValue(data[row.header] as string);
      }
    }
  }

  private async owners(snapshot: CompanySnapshot, period: string) {
    const sourcePeriod = period === "annual" ? "yearly" : "quarterly";
    const table = snapshot.tables[`${sourcePeriod}-shp`] ?? [];
    const groups = { Promoters: "promoters", FIIs: "foreign_institutions", DIIs: "domestic_institutions", Government: "government", Public: "public" };
    const result: { group: string; name: string; data: Record<string, number | null> }[] = [];
    for (const [group, code] of Object.entries(groups)) {
      if (!table.some((r) => group in r.values)) continue;
      const details = await this.detailRows(`/api/3/${snapshot.refId}/investors/${code}/${sourcePeriod}/`);
      for (const [name, data] of Object.entries(details)) result.push({ group, name, data: Object.fromEntries(table.map((r) => [r.header, typeof data[r.header] === "string" ? numericValue(data[r.header] as string) : null])) });
    }
    return { table, owners: result };
  }

  async snapshot(symbol: string) {
    const path = symbol.endsWith("/") ? symbol : `${symbol}/`;
    if (!validCompanyPath(path)) throw new DataError("symbol must be a company URL path", 400, "INVALID_QUERY");
    try {
      const result = await getCompanySnapshot(path, { baseUrl: this.baseUrl, cookie: this.cookie, cache: this.sourceCache }, () => this.html(path));
      return { ...result.value, symbol };
    }
    catch (error) {
      if (error instanceof DataError) throw error;
      if (error instanceof CacheBusyError) throw new DataError(error.message, 503, "SOURCE_BUSY");
      throw new DataError("Source company page could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED");
    }
  }

  private paged(body: unknown, html: string, page: number): DataResult {
    const next = nextPage(html, page);
    return { body, headers: { "X-Page": String(page), "X-Next-Page": next == null ? "" : String(next), "X-Data-Coverage": "partial" } };
  }

  async execute(resource: string, query: DataQuery): Promise<DataResult> {
    const page = Number(query.page ?? "1");
    const symbol = query.symbol;
    const within = (date: string | null) => (!query.from_date || (date != null && date >= query.from_date)) && (!query.to_date || (date != null && date <= query.to_date));
    if (resource === "corporate-actions/all" && query.action && !["bonus", "split", "rights", "dividend"].includes(query.action.toLowerCase())) throw new DataError("action must be bonus, split, rights or dividend", 400, "INVALID_QUERY");
    if (resource === "results-calendar") {
      const html = await this.html(`/upcoming-results/?p=${page}`);
      const rows = parseAdminRows(html).map((r) => ({ symbol: r.symbol, company_name: r.name, expected_result_date: sourceDate(r.fields.result_date ?? "") })).filter((r) => within(r.expected_result_date));
      return this.paged(rows, html, page);
    }
    if (resource === "corporate-actions/all" && !symbol) {
      const kinds = query.action ? [query.action.toLowerCase()] : ["bonus", "split", "rights", "dividend"];
      if (kinds.some((k) => !["bonus", "split", "rights", "dividend"].includes(k))) throw new DataError("action must be bonus, split, rights or dividend", 400, "INVALID_QUERY");
      const rows: unknown[] = []; let next: number | null = null;
      for (const kind of kinds) {
        const html = await this.html(`/actions/${kind === "rights" ? "right" : kind}/?o=-1&p=${page}`);
        next = Math.max(next ?? 0, nextPage(html, page) ?? 0) || null;
        for (const row of parseAdminRows(html)) {
          const date = sourceDate(row.fields.ex_date ?? ""); if (!within(date)) continue;
          rows.push({ symbol: row.symbol, action: kind, ex_date: date, amount: null, adj_amount: null, dividend_type: row.fields.div_type ?? null,
            subject: kind === "dividend" ? `${row.fields.div_type ?? "Dividend"}: ${row.fields.percent ?? "unknown"}% of face value` : row.fields.ratio ?? (row.fields.new_fv ? `New face value: ${row.fields.new_fv}` : null), timestamp_unix: null });
        }
      }
      return { body: rows, headers: { "X-Page": String(page), "X-Next-Page": next ? String(next) : "" } };
    }
    if (!symbol) throw new DataError("The current source requires symbol for this dataset");
    const snapshot = await this.snapshot(symbol);
    let body: unknown;
    if (resource === "company-profile") body = { symbol, name: snapshot.name, bse_code: snapshot.bseCode, nse_code: snapshot.nseCode,
      description: snapshot.description, website: snapshot.website, market_cap: snapshot.summary["Market Cap"] ?? null,
      ...Object.fromEntries(Object.keys(groupDepth).map((g) => [g, snapshot.classifications[g]?.name ?? null])) };
    else if (["quarterly-profit-loss", "profit-loss", "balance-sheet", "cash-flow"].includes(resource)) {
      const code = resource === "balance-sheet" ? "bs" : resource === "cash-flow" ? "cf" : "pl";
      if (code === "bs") await this.expandSchedules(snapshot, "balance-sheet", ["Other Assets", "Other Liabilities", "Borrowings"]);
      let rows = financials(snapshot, code, resource === "quarterly-profit-loss" ? "quarterly" : "annual");
      if (resource === "profit-loss") {
        rows = [...rows, ...financials(snapshot, "pl", "ttm")];
      }
      body = { symbol, financials: rows };
    }
    else if (resource === "ratios") body = { symbol, ratios: ratios(snapshot, "pr"), metrics: snapshot.tables.ratios ?? [] };
    else if (resource === "basic-financials") body = { symbol, summary: snapshot.summary, about: snapshot.description, keyPoints: snapshot.keyPoints,
      basicFinance: { change: snapshot.change, high52: snapshot.summary.high52 ?? null, low52: snapshot.summary.low52 ?? null, market_cap: snapshot.summary["Market Cap"] ?? null, price: snapshot.summary["Current Price"] ?? null, shares: null, tradetime: null, volume: null }, analysis: snapshot.analysis };
    else if (resource === "company-documents") {
      const groups = { annualReports: "report", announcements: "announcement", creditRatings: "credit-rating", callTranscripts: "transcript", presentations: "presentation", other: "other" };
      body = { symbol, documents: Object.fromEntries(Object.entries(groups).map(([group, kind]) => [group, snapshot.documents.filter((doc) => doc.kind === kind).map(({ kind: _, ...doc }) => doc)])) };
    }
    else if (resource === "peer-comparison") {
      try { body = { symbol, peers: parsePeerComparison(await this.html(`/api/company/${snapshot.warehouseId}/peers`, true)) }; }
      catch (error) { if (error instanceof DataError) throw error; throw new DataError("Peer comparison could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"); }
    }
    else if (resource === "shareholding-pattern") {
      const { table: selected, owners } = await this.owners(snapshot, "quarterly");
      const groups = [...new Set(selected.flatMap((r) => Object.keys(r.values)))].filter((g) => g !== "No. of Shareholders");
      body = { stock_symbol: symbol, company_name: snapshot.name, status: "Success", columns: selected.map((r) => r.header),
        rows: groups.map((name) => ({ name, catagory: null, shareholders: owners.filter((o) => o.group === name).map(({ name, data }) => ({ name, data })), data: Object.fromEntries(selected.map((r) => [r.header, r.values[name] ?? null])) })) };
    }
    else if (["shareholdings/ownership-current", "shareholdings/ownership-history"].includes(resource)) {
      const { table, owners } = await this.owners(snapshot, query.period ?? "quarterly");
      const rowFor = (header: string) => owners.filter((o) => o.data[header] != null).map((o) => ({ ...blankFields("shareholdings_ownership_current", "ownerships"), shareholder_name: o.name, group: o.group, shareholdingPct: o.data[header] }));
      if (resource === "shareholdings/ownership-current") body = { symbol, quarter: table.at(-1)?.header ?? null, ownerships: table.length ? rowFor(table.at(-1)!.header) : [] };
      else body = { symbol, period: query.period, ownership_histories: table.map((r) => ({ header: r.header, data: rowFor(r.header) })) };
    }
    else if (resource === "shareholdings/summary" || resource === "shareholdings/distribution") {
      const period = resource === "shareholdings/distribution" ? "quarterly" : query.period;
      const rows = snapshot.tables[period === "annual" ? "yearly-shp" : "quarterly-shp"] ?? [];
      if (resource === "shareholdings/summary") body = { symbol, period: query.period, summary: rows.map((r) => ({ ...blankFields("shareholdings_summary", "summary"), header: r.header, totalShareholders: pick(r, "No. of Shareholders"), promoterShareholding: pick(r, "Promoters") })) };
      else {
        const fields = responseSchemas.shareholdings_distribution!.properties!.distributions!.items!.properties!.distributions!.items!.properties!.data!.properties!;
        body = { symbol, period, distributions: rows.map((r) => ({ date_header: r.header, distributions: Object.entries(r.values).filter(([g]) => g !== "No. of Shareholders").map(([group, shareholdingPct]) => ({ group, data: { ...Object.fromEntries(Object.keys(fields).map((k) => [k, null])), shareholdingPct } })) })) };
      }
    }
    else if (["corporate-actions", "corporate-actions/all", "dividend"].includes(resource)) {
      const includeRights = resource !== "dividend" && (!query.action || query.action === "rights");
      if (page !== 1 && !includeRights) throw new DataError("The company action modal does not have a page cursor");
      const actions = page === 1 && query.action !== "rights" ? parseCorporateActions(await this.html(`/company/actions/${snapshot.refId}/`, true)) : [];
      if (resource === "dividend") body = { symbol, dividend: actions.filter((a) => a.kind === "dividend").map((a) => ({ date: a.date, amount: numericValue(a.title), adj_amount: null, dividend_type: a.description.split(" - ")[0] || null, subject: a.description || null })) };
      else {
        const rows = actions.filter((a) => !["equityhistory", "esops", "rights"].includes(a.kind) && (!query.action || a.kind === query.action) && within(a.date)).map((a) => ({ symbol, action: a.kind, ex_date: a.date,
          amount: a.kind === "dividend" ? numericValue(a.title) : null, adj_amount: null, dividend_type: a.kind === "dividend" ? a.description.split(" - ")[0] || null : null,
          subject: [a.title, a.description].filter(Boolean).join("; ") || null, timestamp_unix: null }));
        if (includeRights) {
          const html = await this.html(`/actions/right/?o=-1&p=${page}&q=${encodeURIComponent(snapshot.name.replace(/\s+Ltd\.?$/, ""))}`);
          const normalize = (path: string) => path.replace(/\/consolidated\/?$/, "/").replace(/\/$/, "").toUpperCase();
          const companyPaths = [symbol, `/company/id/${snapshot.refId}/`, ...[snapshot.nseCode, snapshot.bseCode].filter((code): code is string => Boolean(code)).flatMap((code) => [`/company/${code}/`, `/company/${encodeURIComponent(code)}/`])].map(normalize);
          for (const row of parseAdminRows(html)) {
            const date = sourceDate(row.fields.ex_date ?? "");
            if (row.symbol && companyPaths.includes(normalize(row.symbol)) && within(date)) rows.push({ symbol, action: "rights", ex_date: date, amount: null, adj_amount: null, dividend_type: null, subject: row.fields.ratio ?? null, timestamp_unix: null });
          }
          return this.paged(resource === "corporate-actions/all" ? rows : { symbol, actions: rows }, html, page);
        }
        body = resource === "corporate-actions/all" ? rows : { symbol, actions: rows };
      }
    }
    else throw new DataError("The connected sources do not supply this dataset");
    return { body, headers: { "X-Data-Coverage": "partial" } };
  }
}
