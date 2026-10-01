import { parseCompanySnapshot, parseCompanyLinks, parseMarketLinks, parseAdminRows, parseCorporateActions, parseAnnouncementFeed, sourceDate, numericValue, nextPage, symbolFromPath, type CompanySnapshot, type FinancialRow } from "@stock-market/scraper/helper/getCompanySnapshot";
import { parseUpcomingIpoHtml } from "@stock-market/scraper/helper/getUpcommingIPO";
import { responseSchemas } from "./reference-schemas.js";
import { errorDetails, log } from "@stock-market/common/logger";
import taxonomy from "./screener-taxonomy.json" with { type: "json" };

export class DataError extends Error {
  constructor(message: string, public status: 400 | 404 | 429 | 501 | 502 | 503 = 501, public code = "DATASET_UNAVAILABLE") { super(message); }
}

export type DataResult = { body: unknown; headers?: Record<string, string> };
export type DataQuery = Record<string, string>;
export interface DataProvider { execute(resource: string, query: DataQuery): Promise<DataResult> }

const groupDepth: Record<string, number> = { macro_sector: 1, industry: 2, sector: 3, sub_industry: 4 };
const sum = (...xs: (number | null | undefined)[]): number | null => xs.some((x) => x == null) ? null : xs.reduce<number>((a, b) => a + b!, 0);
const divide = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || b === 0 ? null : a / b;
const rupees = (n: number | null | undefined) => n == null ? null : n * 10_000_000;
const year = (header: string) => Number(header.match(/20\d{2}/)?.[0]) || null;
const formatDate = (date: Date | null) => date ? `${String(date.getUTCDate()).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]}-${date.getUTCFullYear()}` : null;
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
      // The source Expenses row is operating expenses; FinEdge's expenses is
      // total expenses, including finance costs and depreciation.
      return { ...blankFields("financials", "financials"), ...meta,
        revenueFromOperations: rupees(revenue), otherIncome: rupees(other), income: rupees(sum(revenue, other)),
        expenses: rupees(sum(pick(row, "Expenses"), pick(row, "Interest"), pick(row, "Depreciation"))),
        financeCosts: rupees(pick(row, "Interest")), depreciationAndAmortisation: rupees(pick(row, "Depreciation")),
        profitBeforeTax: rupees(pick(row, "Profit before tax")), profitLossForPeriod: rupees(pick(row, "Net Profit")),
        EPS: pick(row, "EPS in Rs") };
    }
    if (code === "bs") {
      const equity = sum(pick(row, "Equity Capital"), pick(row, "Reserves"));
      return { ...meta, totalEquity: rupees(equity), equityCapital: rupees(pick(row, "Equity Capital")), reserves: rupees(pick(row, "Reserves")),
        liabilities: rupees(sum(pick(row, "Borrowings", "Borrowing"), pick(row, "Other Liabilities"))),
        equityAndLiabilities: rupees(pick(row, "Total Liabilities")), assets: rupees(pick(row, "Total Assets")),
        capitalWorkInProgress: rupees(pick(row, "CWIP")), inventories: rupees(pick(row, "Inventories")), tradeReceivables: rupees(pick(row, "Trade receivables")), cashAndCashEquivalents: rupees(pick(row, "Cash Equivalents")),
        tradePayables: rupees(pick(row, "Trade Payables")), longTermBorrowings: rupees(pick(row, "Long term Borrowings")), shortTermBorrowings: rupees(pick(row, "Short term Borrowings")),
        currentAssets: null, noncurrentAssets: null, currentLiabilities: null, noncurrentLiabilities: null };
    }
    return { ...meta, cashFlowsFromOperatingActivities: rupees(pick(row, "Cash from Operating Activity")),
      cashFlowsFromInvestingActivities: rupees(pick(row, "Cash from Investing Activity")),
      cashFlowsFromFinancingActivities: rupees(pick(row, "Cash from Financing Activity")), netCashFlow: rupees(pick(row, "Net Cash Flow")) };
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

function basicFinancials(snapshot: CompanySnapshot, code: string) {
  if (code !== "pl") throw new DataError("Only basic profit-loss fields (statement_code=pl) have a verified mapping");
  return fullYears(snapshot.tables["profit-loss"] ?? []).map((row) => {
    const ebit = sum(pick(row, "Profit before tax"), pick(row, "Interest"));
    return { ...blankFields("basic_financials", "basic_financials"), header: row.header, year: year(row.header),
      ebit: rupees(ebit), ebitda: rupees(sum(ebit, pick(row, "Depreciation"))),
      operatingProfit: rupees(pick(row, "Operating Profit", "Financing Profit")), operatingRevenue: rupees(pick(row, "Sales", "Revenue")),
      // Gross income, adjusted historic capital, share counts and COGS are not
      // identifiable from these aggregate rows.
      tax: divide(pick(row, "Tax %"), 100) };
  });
}

export class ScreenerProvider implements DataProvider {
  private readonly cache = new Map<string, { html: string; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly cookie?: string;
  constructor(options: { baseUrl?: string; cookie?: string; fetcher?: typeof fetch } = {}) {
    this.baseUrl = options.baseUrl ?? "https://www.screener.in";
    this.cookie = options.cookie;
    // Workers requires the native fetch receiver to be globalThis, not this provider.
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  async html(path: string, ajax = false): Promise<string> {
    const cacheKey = `${ajax ? "ajax:" : ""}${path}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.html;
    const pending = this.pending.get(cacheKey); if (pending) return pending;
    if (this.pending.size >= 8) throw new DataError("Source capacity reached; retry later", 503, "SOURCE_BUSY");
    const request = (async () => {
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
      if (response.status === 429) throw new DataError("Screener request limit reached; retry later", 503, "SOURCE_RATE_LIMITED");
      if (!response.ok) throw new DataError(`The data source returned HTTP ${response.status}`, 502, "UPSTREAM_UNAVAILABLE");
      if (path.includes("/consolidated/") && response.url && !new URL(response.url).pathname.includes("/consolidated/")) throw new DataError("Consolidated company statements are unavailable", 404, "NOT_FOUND");
      const html = await response.text();
      if (/form[^>]+action=["'][^"']*login/i.test(html) || /<title>[^<]*(?:login|sign in|register)/i.test(html)) throw new DataError("The source requires a valid Screener session", 502, "SOURCE_AUTH_REQUIRED");
      // Bound the cache and coalesce concurrent requests for the same source page.
      this.cache.delete(cacheKey); this.cache.set(cacheKey, { html, expiresAt: Date.now() + 900_000 });
      if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
      return html;
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

  async snapshot(symbol: string, statementType = "s") {
    const path = `/company/${encodeURIComponent(symbol)}/${statementType === "c" ? "consolidated/" : ""}`;
    try { return parseCompanySnapshot(await this.html(path), symbol, statementType === "c"); }
    catch (error) { this.cache.delete(path); if (error instanceof DataError) throw error; throw new DataError("Source company page could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"); }
  }

  private paged(body: unknown, html: string, page: number): DataResult {
    const next = nextPage(html, page);
    return { body, headers: { "X-Page": String(page), "X-Next-Page": next == null ? "" : String(next), "X-Data-Coverage": "partial", "X-Data-Source": "screener" } };
  }

  async execute(resource: string, query: DataQuery): Promise<DataResult> {
    const page = Number(query.page ?? "1");
    const symbol = query.symbol;
    if (resource === "stock-symbols") {
      const html = await this.html(`/screens/357649/all-listed-companies/?limit=100&page=${page}`);
      const links = parseCompanyLinks(html);
      if (!links.length) throw new DataError("Source returned no company directory", 502, "UPSTREAM_SCHEMA_CHANGED");
      return this.paged(links.map((x) => { const s = symbolFromPath(x.path)!; return { symbol: s, name: x.name, nse_code: /^\d+$/.test(s) ? null : s, bse_code: /^\d{6}$/.test(s) ? s : null, consolidated_ind: x.path.includes("/consolidated/") }; }), html, page);
    }
    if (resource === "stock-search") {
      const depth = groupDepth[query.group!];
      const matches = (links: { name: string; path: string }[]) => links.find((x) => x.name.toLowerCase() === query.value!.toLowerCase() && x.path.split("/").filter(Boolean).length - 1 === depth);
      const match = matches(taxonomy.entries) ?? matches(parseMarketLinks(await this.html("/market/")));
      if (!match) throw new DataError("Classification not found in the source directory", 404, "NOT_FOUND");
      const html = await this.html(`${match.path}?page=${page}`);
      return this.paged({ symbols: parseCompanyLinks(html).map((x) => symbolFromPath(x.path)) }, html, page);
    }
    if (resource === "ipo-calendar") {
      const html = await this.html(`/ipo/?page=${page}`);
      const ipos = parseUpcomingIpoHtml(html).filter((x) => /[a-z]/i.test(x.name));
      const body = ipos.filter((x) => !query.from_date || (x.subscription_period.start_date && x.subscription_period.start_date.toISOString().slice(0, 10) >= query.from_date))
        .filter((x) => !query.to_date || (x.subscription_period.start_date && x.subscription_period.start_date.toISOString().slice(0, 10) <= query.to_date))
        .map((x) => ({ company_name: x.name, current_bids: x.subscription.breakdown?.total?.bids_received?.toLocaleString("en-IN") ?? null,
          end_date: formatDate(x.subscription_period.end_date),
          exchange: x.exchanges.map((e) => e.exchange), ipo_status: null,
          issue_size: x.subscription.breakdown?.total?.shares_offered?.toLocaleString("en-IN") ?? null,
          price_range: x.price.lower_band == null ? null : x.price.upper_band === x.price.lower_band ? `Rs.${x.price.lower_band}` : `Rs.${x.price.lower_band} to Rs.${x.price.upper_band}`,
          security_type: null, start_date: formatDate(x.subscription_period.start_date),
          subscription: x.subscription.total_times?.toString() ?? null, symbol: x.exchanges.flatMap((e) => { try { const s = new URL(e.url).searchParams.get("symbol"); return s ? [s] : []; } catch { return []; } })[0] ?? null }));
      return this.paged({ data: body }, html, page);
    }
    const within = (date: string | null) => (!query.from_date || (date != null && date >= query.from_date)) && (!query.to_date || (date != null && date <= query.to_date));
    if (resource === "corporate-actions/all" && query.action && !["bonus", "split", "rights", "dividend"].includes(query.action.toLowerCase())) throw new DataError("action must be bonus, split, rights or dividend", 400, "INVALID_QUERY");
    if (resource === "results-calendar") {
      const html = await this.html(`/upcoming-results/?p=${page}`);
      const rows = parseAdminRows(html).map((r) => ({ symbol: r.symbol, company_name: r.name, expected_result_date: sourceDate(r.fields.result_date ?? "") })).filter((r) => within(r.expected_result_date));
      return this.paged(rows, html, page);
    }
    if (resource === "corp-announcements" && !symbol) {
      if (page !== 1) throw new DataError("The market-wide announcement page has no stable page cursor");
      const html = await this.html("/announcements/all/");
      const rows = parseAnnouncementFeed(html);
      if ((query.from_date || query.to_date) && rows.some((r) => !r.date)) throw new DataError("Some market feed records lack dates; exact date filtering is unavailable");
      return { body: rows.filter((r) => within(r.date)).map((r) => ({ stock_symbol: r.symbol, bse_code: r.symbol && /^\d{6}$/.test(r.symbol) ? r.symbol : null,
        nse_code: r.symbol && !/^\d+$/.test(r.symbol) ? r.symbol : null, category: r.title, sub_category: null,
        description: r.description, ex_date: r.date, timestamp_unix: r.timestamp, pdf_file_link: r.url, pdf_file_link_hist: null })), headers: { "X-Data-Source": "screener", "X-Data-Coverage": "partial" } };
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
      return { body: rows, headers: { "X-Page": String(page), "X-Next-Page": next ? String(next) : "", "X-Data-Source": "screener" } };
    }
    if (!symbol) throw new DataError("The current source requires symbol for this dataset");
    const snapshot = await this.snapshot(symbol, query.statement_type);
    let body: unknown;
    if (resource === "company-profile") body = { symbol, name: snapshot.name, bse_code: snapshot.bseCode, nse_code: snapshot.nseCode,
      description: snapshot.description, website: snapshot.website, market_cap: snapshot.summary["Market Cap"] ?? null,
      ...Object.fromEntries(Object.keys(groupDepth).map((g) => [g, snapshot.classifications[g]?.name ?? null])) };
    else if (resource === "quote" || resource === "quotes") {
      const quote = { symbol, change: snapshot.change, high52: snapshot.summary.high52 ?? null, low52: snapshot.summary.low52 ?? null,
        market_cap: snapshot.summary["Market Cap"] ?? null, price: snapshot.summary["Current Price"] ?? null,
        shares: null, tradetime: null, volume: null };
      body = resource === "quotes" ? [{ ...(({ change: _, ...value }) => value)(quote), high_price: null, low_price: null, open_price: null }] : { [symbol]: (({ symbol: _, ...value }) => value)(quote) };
    }
    else if (resource === "financials") {
      if (query.statement_code === "bs" && query.period === "annual") await this.expandSchedules(snapshot, "balance-sheet", ["Other Assets", "Other Liabilities", "Borrowings"]);
      body = { symbol, financials: financials(snapshot, query.statement_code!, query.period!) };
    }
    else if (resource === "ratios") body = { symbol, ratios: ratios(snapshot, query.ratio_type!) };
    else if (resource === "basic-financials") body = { symbol, basic_financials: basicFinancials(snapshot, query.statement_code!) };
    else if (resource === "financial-metrics") {
      if (query.ratio_type !== "cu") throw new DataError("Only cumulative cash-flow metrics (ratio_type=cu) have a verified mapping");
      const rows = annualRows(snapshot, "cash-flow").slice(-3);
      if (rows.length !== 3 || year(rows[2]!.header)! - year(rows[0]!.header)! !== 2) throw new DataError("Three consecutive annual cash-flow periods are required");
      body = { symbol, ratio_type: "Cummulative", financial_metrics: {
        operatingCashFlow3yearsTotal: rupees(sum(...rows.map((r) => pick(r, "Cash from Operating Activity")))),
        investingCashFlow3yearsTotal: rupees(sum(...rows.map((r) => pick(r, "Cash from Investing Activity")))),
        financingCashFlow3yearsTotal: rupees(sum(...rows.map((r) => pick(r, "Cash from Financing Activity")))),
        freeCashFlow3yearsTotal: rupees(sum(...rows.map((r) => pick(r, "Free Cash Flow")))) } };
    }
    else if (resource === "company-reports") {
      const reports = new Map<number, { year: number; period: string; to_date: null; bse_url: string | null; nse_url: string | null }>();
      for (const doc of snapshot.documents.filter((d) => d.kind === "report" && d.year)) {
        const report = reports.get(doc.year!) ?? { year: doc.year!, period: "Annual", to_date: null, bse_url: null, nse_url: null };
        if (new URL(doc.url).hostname.endsWith("bseindia.com")) report.bse_url = doc.url;
        if (new URL(doc.url).hostname.endsWith("nseindia.com")) report.nse_url = doc.url;
        reports.set(doc.year!, report);
      }
      body = { symbol, reports: [...reports.values()] };
    }
    else if (resource === "peers") {
      const group = query.group ?? "sector";
      const path = snapshot.classifications[group]?.path;
      if (!path) throw new DataError("The source does not classify this company in the requested group");
      const html = await this.html(`${path}?page=${page}`);
      return this.paged({ peers: parseCompanyLinks(html).map((x) => symbolFromPath(x.path)).filter((s) => s !== symbol) }, html, page);
    }
    else if (resource === "shareholdings/pattern") {
      const { table: selected, owners } = await this.owners(snapshot, query.period!);
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
      const rows = snapshot.tables[query.period === "annual" ? "yearly-shp" : "quarterly-shp"] ?? [];
      if (resource === "shareholdings/summary") body = { symbol, period: query.period, summary: rows.map((r) => ({ ...blankFields("shareholdings_summary", "summary"), header: r.header, totalShareholders: pick(r, "No. of Shareholders"), promoterShareholding: pick(r, "Promoters") })) };
      else {
        const fields = responseSchemas.shareholdings_distribution!.properties!.distributions!.items!.properties!.distributions!.items!.properties!.data!.properties!;
        body = { symbol, period: query.period, distributions: rows.map((r) => ({ date_header: r.header, distributions: Object.entries(r.values).filter(([g]) => g !== "No. of Shareholders").map(([group, shareholdingPct]) => ({ group, data: { ...Object.fromEntries(Object.keys(fields).map((k) => [k, null])), shareholdingPct } })) })) };
      }
    }
    else if (["corporate-actions", "corporate-actions/all", "dividend"].includes(resource)) {
      if (resource === "corporate-actions" && query.corp_action === "rights") {
        const html = await this.html(`/actions/right/?o=-1&p=${page}&q=${encodeURIComponent(snapshot.name.replace(/\s+Ltd\.?$/, ""))}`);
        return this.paged({ symbol, rights: parseAdminRows(html).filter((r) => r.symbol === symbol).map((r) => ({ date: sourceDate(r.fields.ex_date ?? ""), action: r.fields.ratio ?? null })) }, html, page);
      }
      if (page !== 1) throw new DataError("The company action modal does not have a page cursor");
      const actions = parseCorporateActions(await this.html(`/company/actions/${snapshot.refId}/`, true));
      const dividend = actions.filter((a) => a.kind === "dividend").map((a) => ({ date: a.date, amount: numericValue(a.title), adj_amount: null, dividend_type: a.description.split(" - ")[0] || null, subject: a.description || null }));
      if (resource === "dividend") body = { symbol, dividend };
      else if (resource === "corporate-actions") body = { symbol, [query.corp_action!]: actions.filter((a) => a.kind === query.corp_action).map((a) => ({ date: a.date, action: [a.title, a.description].filter(Boolean).join("; ") })) };
      else {
        if (query.action?.toLowerCase() === "rights") throw new DataError("Use the rights endpoint for company-specific rights issues");
        body = actions.filter((a) => !["equityhistory", "esops"].includes(a.kind) && (!query.action || a.kind === query.action.toLowerCase()) && within(a.date)).map((a) => ({ symbol, action: a.kind, ex_date: a.date,
          amount: a.kind === "dividend" ? numericValue(a.title) : null, adj_amount: null, dividend_type: a.kind === "dividend" ? a.description.split(" - ")[0] || null : null,
          subject: [a.title, a.description].filter(Boolean).join("; "), timestamp_unix: null }));
      }
    }
    else if (["corp-announcements", "credit-ratings", "investor-call-transcripts", "investor-presentations"].includes(resource)) {
      const kind = { "corp-announcements": "announcement", "credit-ratings": "credit-rating", "investor-call-transcripts": "transcript", "investor-presentations": "presentation" }[resource]!;
      const documents = snapshot.documents.filter((d) => d.kind === kind);
      if ((query.from_date || query.to_date) && documents.some((d) => !d.date)) throw new DataError("The source only supplies month-level dates for these documents; exact date filtering is unavailable");
      if (kind === "transcript" && !documents.length) throw new DataError("Transcript links are not accessible in this source session");
      body = documents.filter((d) => !query.from_date || (d.date && d.date >= query.from_date)).filter((d) => !query.to_date || (d.date && d.date <= query.to_date)).map((d) => ({
        stock_symbol: symbol, bse_code: snapshot.bseCode, nse_code: snapshot.nseCode, category: d.title, sub_category: null,
        description: d.title, ex_date: d.date, timestamp_unix: null, pdf_file_link: d.url, pdf_file_link_hist: null }));
    }
    else throw new DataError("The connected sources do not supply this dataset");
    return { body, headers: { "X-Data-Coverage": "partial", "X-Data-Source": "screener" } };
  }
}
