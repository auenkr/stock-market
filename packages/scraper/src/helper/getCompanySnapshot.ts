import * as cheerio from "cheerio";
import { BASE_URL, COOKIE } from "@stock-market/common/env";
import { sourceGet, SourceError, type SourceOptions } from "../utils/source.js";
import { COMPANY_CACHE_TTL, sourceCacheKey, type CacheResult } from "../utils/cache.js";

export type FinancialRow = { header: string; values: Record<string, number | null> };
export type DocumentLink = { title: string; url: string; date: string | null; year: number | null; kind: string };
export type CompanySnapshot = {
  symbol: string;
  refId: string;
  warehouseId: string;
  name: string;
  bseCode: string | null;
  nseCode: string | null;
  website: string | null;
  description: string;
  keyPoints: string;
  analysis: { pros: string[]; cons: string[] };
  consolidated: boolean;
  classifications: Record<string, { name: string; path: string }>;
  summary: Record<string, number | null>;
  change: string | null;
  tables: Record<string, FinancialRow[]>;
  documents: DocumentLink[];
  quarterlySourceUrls: string[];
  peerSector: string;
};

export function numericValue(text: string): number | null {
  const value = text.replace(/,/g, "").replace(/[₹%]/g, "").replace(/(?:Cr\.?|Rs\.?)\s*$/i, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function parsePeerComparison(html: string) {
  const $ = cheerio.load(html);
  if (!$("table.data-table").length) throw new Error("Source did not return a peer comparison table");
  const fields = ["currentPrice", "stockPE", "marketCap", "dividendYield", "netProfitLatestQuarter", "YOYQuarterlyProfitGrowth", "salesLatestQuarter", "YOYQuarterlySalesGrowth", "ROCE"];
  return $("table.data-table tbody tr").map((_, tr) => {
    const cells = $(tr).children("td");
    const link = cells.find("a[href^='/company/']").first();
    if (!link.length) return null;
    return { symbol: link.attr("href")!, name: link.text().trim(), ...Object.fromEntries(fields.map((field, i) => [field, numericValue(cells.eq(i + 2).text())])) };
  }).get().filter((row) => row !== null);
}

export function nextPage(html: string, currentPage: number): number | null {
  const $ = cheerio.load(html);
  const pages = $(".pagination a[href], .paginator a[href]").map((_, el) => {
    const href = $(el).attr("href")!;
    const params = new URL(href, "https://source.invalid").searchParams;
    return Number(params.get("page") ?? params.get("p"));
  }).get().filter((p) => Number.isSafeInteger(p) && p > currentPage);
  return pages.length ? Math.min(...pages) : null;
}

export function sourceDate(text: string): string | null {
  const match = text.trim().match(/^(?:(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})|(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}))$/);
  if (!match) return null;
  const iso = Date.parse(`${match[3] ?? match[4]} ${match[2] ?? match[5]} ${match[1] ?? match[6]} 00:00:00 GMT`);
  return Number.isFinite(iso) ? new Date(iso).toISOString().slice(0, 10) : null;
}

export function parseAdminRows(html: string) {
  const $ = cheerio.load(html);
  if (!$("#result_list").length) throw new Error("Source did not return a data table");
  return $("#result_list tbody tr").map((_, tr) => {
    const company = $(tr).find("a[href^='/company/']").filter((_, a) => Boolean($(a).text().trim())).first();
    const fields: Record<string, string> = {};
    $(tr).children("td").each((_, td) => {
      const key = $(td).attr("class")?.match(/\bfield-([\w_]+)/)?.[1];
      if (key) fields[key] = $(td).text().trim();
    });
    return { symbol: company.attr("href") ?? null, name: company.text().trim(), fields };
  }).get();
}

export function parseCorporateActions(html: string) {
  const $ = cheerio.load(html);
  if (!$("[id^='corporate-actions-']").length) throw new Error("Source did not return corporate actions");
  return $("[id^='corporate-actions-'] tbody tr").map((_, tr) => {
    const cells = $(tr).children("td");
    return { kind: $(tr).closest("[id^='corporate-actions-']").attr("id")!.replace("corporate-actions-", ""),
      date: sourceDate((cells.first().children().length ? cells.first().children().map((_, el) => $(el).text().trim()).get().join(" ") : cells.first().text()).replace(/\s+/g, " ").trim()),
      title: cells.eq(1).find(".font-weight-500").text().trim(), description: cells.eq(1).find(".sub").text().trim() };
  }).get();
}

function datedLink(text: string, now: Date): string | null {
  // Screener omits the year for documents in the current year. Never invent a
  // day for month-only concall labels or a time of publication.
  const match = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})(?:\s+(20\d{2}))?\b/);
  if (!match) return null;
  let year = Number(match[3] ?? now.getUTCFullYear());
  let time = Date.parse(`${match[1]} ${match[2]} ${year} 00:00:00 GMT`);
  if (!Number.isFinite(time)) return null;
  if (!match[3] && time > now.getTime()) {
    year -= 1;
    time = Date.parse(`${match[1]} ${match[2]} ${year} 00:00:00 GMT`);
  }
  return new Date(time).toISOString().slice(0, 10);
}

export function parseCompanySnapshot(html: string, symbol: string, consolidated: boolean, now = new Date()): CompanySnapshot {
  const $ = cheerio.load(html);
  const refId = $("#company-info").attr("data-company-id");
  const name = $("#top h1").first().text().trim();
  if (!refId || !name) throw new Error("Source did not return a company page");
  const topLinks = $("#top a[href^='http']").map((_, el) => ({
    text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href")!,
  })).get();
  const nse = topLinks.find((x) => /NSE:/.test(x.text));
  const bse = topLinks.find((x) => /BSE:/.test(x.text));
  const website = topLinks.find((x) => !/nseindia\.com|bseindia\.com/.test(new URL(x.href).hostname));
  const summary: Record<string, number | null> = {};
  $("#top-ratios li").each((_, el) => {
    const label = $(el).find(".name").text().replace(/\s+/g, " ").trim();
    const text = $(el).find(".value").text().replace(/\s+/g, " ").trim();
    if (label === "High / Low") {
      const [high, low] = text.split("/");
      summary.high52 = numericValue(high ?? ""); summary.low52 = numericValue(low ?? "");
    } else summary[label] = numericValue(text);
  });
  const classifications: CompanySnapshot["classifications"] = {};
  const groupNames = ["macro_sector", "industry", "sector", "sub_industry"];
  $("#peers a[href^='/market/']").each((_, el) => {
    const path = $(el).attr("href")!;
    const depth = path.split("/").filter(Boolean).length - 1;
    const group = groupNames[depth - 1];
    if (group) classifications[group] = { name: $(el).text().trim(), path };
  });
  const tables: CompanySnapshot["tables"] = {};
  for (const section of ["quarters", "profit-loss", "balance-sheet", "cash-flow", "ratios", "quarterly-shp", "yearly-shp"]) {
    const table = $(`#${section} table`).first();
    const headers = table.find("thead th").slice(1).map((_, el) => $(el).text().trim()).get();
    const rows: FinancialRow[] = headers.map((header) => ({ header, values: {} }));
    table.find("tbody tr").each((_, tr) => {
      const cells = $(tr).children("td");
      const label = cells.first().text().replace(/\+/g, "").replace(/\s+/g, " ").trim();
      if (!label || label === "Raw PDF" || cells.length !== headers.length + 1) return;
      cells.slice(1).each((i, td) => { if (rows[i]) rows[i]!.values[label] = numericValue($(td).text()); });
    });
    tables[section] = rows;
  }
  const documents: DocumentLink[] = [];
  for (const [selector, kind] of [[".annual-reports li", "report"], ["#company-announcements-tab li", "announcement"], [".credit-ratings li", "credit-rating"], [".concalls li", "concall"]]) {
    $(selector!).each((_, li) => {
      const text = $(li).text().replace(/\s+/g, " ").trim();
      $(li).find("a[href^='http']").each((_, a) => {
        const title = $(a).clone().children().remove().end().text().trim();
        documents.push({ title, url: $(a).attr("href")!, date: datedLink(text, now),
          year: Number(text.match(/\b20\d{2}\b/)?.[0]) || null,
          kind: kind === "concall" ? (/transcript/i.test(title) ? "transcript" : /PPT/i.test(title) ? "presentation" : "other") : kind!,
        });
      });
    });
  }
  const change = $("#top .font-size-12").map((_, el) => $(el).text().trim()).get().find((t) => /^-?\d+(?:\.\d+)?%$/.test(t)) ?? null;
  return { symbol, refId, warehouseId: $("#company-info").attr("data-warehouse-id") ?? refId,
    name, bseCode: bse?.text.match(/\d+/)?.[0] ?? null, nseCode: nse?.text.split(":")[1]?.trim() ?? null,
    website: website?.href ?? null, description: $(".about p").text().trim(),
    keyPoints: $("div.title:contains('Key Points')").next(".sub.commentary").text().trim(),
    analysis: { pros: $(".pros ul li").map((_, el) => $(el).text().trim()).get(), cons: $(".cons ul li").map((_, el) => $(el).text().trim()).get() }, consolidated,
    classifications, summary, change, tables, documents,
    quarterlySourceUrls: $("#quarters tbody tr.font-size-14.ink-600 td a").map((_, a) => $(a).attr("href") ?? "").get(),
    peerSector: $('p[class="sub"]').first().text().replace(/\s+/g, " ").trim() };
}

/** The canonical page is fetched and parsed once for both API adapters. */
export async function getCompanySnapshot(symbol: string, source: SourceOptions = {}, loadHtml?: () => Promise<string>): Promise<CacheResult<CompanySnapshot>> {
  const path = symbol.endsWith("/") ? symbol : `${symbol}/`;
  const consolidated = path.includes("/consolidated/");
  const load = async () => {
    let html: string;
    if (loadHtml) html = await loadHtml();
    else {
      try {
        // Do not allow a legacy load to fill the shared consolidated key with
        // a redirect to standalone statements. fetch and Axios use the same rule.
        html = (await sourceGet<string>(path, { ...source, cache: undefined }, consolidated
          ? { maxRedirects: 0, fetchOptions: { cache: "no-store", redirect: "manual" } } : {})).data;
      } catch (error) {
        const response = (error as { response?: { status: number; headers?: { location?: string } } }).response;
        if (consolidated && response && response.status >= 300 && response.status < 400 && response.headers?.location && !new URL(response.headers.location, source.baseUrl ?? BASE_URL).pathname.includes("/consolidated/")) {
          throw new SourceError("Consolidated company statements are unavailable", "NOT_FOUND", 404);
        }
        throw error;
      }
    }
    return parseCompanySnapshot(html, path, consolidated);
  };
  const result = source.cache && source.cacheEnabled !== false
    ? await source.cache.remember(await sourceCacheKey("company", new URL(path, source.baseUrl ?? BASE_URL), source.cookie ?? COOKIE), COMPANY_CACHE_TTL, load)
    : { value: await load(), hit: false, expiresAt: Date.now() + COMPANY_CACHE_TTL * 1000, durationMs: 0 };
  // Enrichments mutate financial rows; never let them modify the cached base.
  return { ...result, value: { ...structuredClone(result.value), symbol } };
}
