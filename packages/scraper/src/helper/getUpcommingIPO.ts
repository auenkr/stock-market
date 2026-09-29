import * as cheerio from "cheerio";
import { BASE_URL } from "@stock-market/common/env";
import { sendReq } from "../utils/sendReq.js";
import axios from "axios";
import type { AnyNode } from "domhandler";

// -------------------------------------------------------------
// Type Definitions
// -------------------------------------------------------------

export interface ExchangeLink {
  exchange: "NSE" | "BSE" | "NSE-SME" | "BSE-SME" | string;
  url: string;
}

export interface PriceBand {
  lower_band: number | null;
  upper_band: number | null;
  is_fixed_price: boolean;
}

export interface SubscriptionPeriod {
  start_date: Date | null;
  end_date: Date | null;
}

export interface SubscriptionDetailRow {
  shares_offered: number | null;
  bids_received: number | null;
}

export interface CategoryBreakdown {
  institutional: SubscriptionDetailRow | null;
  non_institutional: (SubscriptionDetailRow & {
    above_10_lakh?: SubscriptionDetailRow | null;
    from_2_to_10_lakh?: SubscriptionDetailRow | null;
  }) | null;
  retail: SubscriptionDetailRow | null;
  total: SubscriptionDetailRow | null;
}

export interface SubscriptionInfo {
  total_times: number | null;
  breakdown: CategoryBreakdown | null;
}

export interface CompanyIPOData {
  id: string;
  name: string;
  url: string;
  exchanges: ExchangeLink[];
  subscription_period: SubscriptionPeriod;
  price: PriceBand;
  listing_date: Date | null;
  market_cap_cr: number;
  subscription: SubscriptionInfo;
  pe: number;
  roce_percentage: number;
  gmp_percentage: number | null;
}

interface GMPRecord {
  company_short_name: string;
  gmp_perc: string;
}

// -------------------------------------------------------------
// Helper Utilities
// -------------------------------------------------------------

/**
 * Strips commas, symbols (₹, %, etc.) and converts to number or null if unavailable.
 */
function parseNullableNumber(val: string | undefined | null): number | null {
  if (!val) return null;
  const cleaned = val.replace(/,/g, "").replace(/[₹%x\-]/gi, "").trim();
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parses times multiplier like "1.4 times" -> 1.4
 */
function parseSubscriptionTimes(val: string | undefined | null): number | null {
  if (!val) return null;
  const match = val.match(/([\d.]+)\s*times/i);
  return match?.[1] ? parseFloat(match[1]) : parseNullableNumber(val);
}

function parseDate(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)$/i);
  if (!match) return null;

  const day = Number(match[1]);
  const month = new Date(`${match[2]} 1, 2000`).getMonth();
  if (!Number.isInteger(day) || Number.isNaN(month)) return null;

  const date = new Date(Date.UTC(new Date().getFullYear(), month, day));
  return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}

/**
 * Parses price range like "₹385–405", "₹32–34", "100"
 */
function parsePriceBand(rawStr: string): PriceBand {
  const raw = rawStr.trim();
  if (!raw || raw === "-") {
    return { lower_band: null, upper_band: null, is_fixed_price: false };
  }

  // Matches either single price or range with hyphens/en-dashes
  const cleaned = raw.replace(/₹/g, "").trim();
  const parts = cleaned.split(/[-–—]/).map((p) => parseFloat(p.trim())).filter((n) => !isNaN(n));

  if (parts.length === 2) {
    return {
      lower_band: parts[0] ?? null,
      upper_band: parts[1] ?? null,
      is_fixed_price: false,
    };
  } else if (parts.length === 1) {
    return {
      lower_band: parts[0] ?? null,
      upper_band: parts[0] ?? null,
      is_fixed_price: true,
    };
  }

  return { lower_band: null, upper_band: null, is_fixed_price: false };
}

/**
 * Parses period string: "24th Sep - 28th Sep"
 */
function parseSubscriptionPeriod(rawStr: string): SubscriptionPeriod {
  const raw = rawStr.trim();
  if (!raw) return { start_date: null, end_date: null };

  const parts = raw.split(/[-–—]/).map((s) => s.trim());
  return {
    start_date: parts[0] ? parseDate(parts[0]) : null,
    end_date: parts[1] ? parseDate(parts[1]) : null,
  };
}

/**
 * Parses individual row from modal table into SubscriptionDetailRow
 */
function parseModalRow($row: cheerio.Cheerio<AnyNode>): SubscriptionDetailRow {
  const tds = $row.find("td");
  return {
    shares_offered: parseNullableNumber(tds.eq(1).text()),
    bids_received: parseNullableNumber(tds.eq(2).text()),
  };
}

function hasCompleteSubscriptionRow(row: SubscriptionDetailRow | null): boolean {
  return row !== null && row.shares_offered !== null && row.bids_received !== null;
}

function hasCompleteIPOData(ipo: CompanyIPOData): boolean {
  const breakdown = ipo.subscription.breakdown;
  const nonInstitutional = breakdown?.non_institutional;

  return (
    ipo.id !== "" &&
    ipo.name !== "" &&
    ipo.url !== "" &&
    ipo.exchanges.length > 0 &&
    ipo.subscription_period.start_date !== null &&
    ipo.subscription_period.end_date !== null &&
    ipo.price.lower_band !== null &&
    ipo.price.upper_band !== null &&
    ipo.listing_date !== null &&
    ipo.market_cap_cr !== 0 &&
    ipo.subscription.total_times !== null &&
    breakdown !== null &&
    hasCompleteSubscriptionRow(breakdown.institutional) &&
    hasCompleteSubscriptionRow(nonInstitutional ?? null) &&
    hasCompleteSubscriptionRow(breakdown.retail) &&
    hasCompleteSubscriptionRow(breakdown.total)
  );
}

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function findGMPPercentage(name: string, records: GMPRecord[]): number | null {
  const normalizedName = normalizeCompanyName(name);
  const exactMatch = records.find((record) => normalizeCompanyName(record.company_short_name) === normalizedName);
  if (exactMatch) return Number(exactMatch.gmp_perc);

  const nameTokens = getNameTokens(name);
  let bestMatch: GMPRecord | undefined;
  let bestScore = 0;

  for (const record of records) {
    const recordTokens = getNameTokens(record.company_short_name);
    const allTokensMatch = nameTokens.every((token) =>
      recordTokens.some((recordToken) => recordToken.startsWith(token) || token.startsWith(recordToken)),
    );
    if (!allTokensMatch) continue;

    const score = nameTokens.reduce((total, token) => {
      const matchedToken = recordTokens.find(
        (recordToken) => recordToken.startsWith(token) || token.startsWith(recordToken),
      );
      return total + (matchedToken ? Math.min(token.length, matchedToken.length) : 0);
    }, 0);

    if (score > bestScore) {
      bestMatch = record;
      bestScore = score;
    }
  }

  return bestMatch ? Number(bestMatch.gmp_perc) : null;
}

async function getGMPRecords(): Promise<GMPRecord[]> {
  const response = await sendReq(() =>
    axios.get("https://webnodejs.investorgain.com/cloud/v2/index/gmp-data"),
  );
  const records = (response.data?.gmpList ?? []) as GMPRecord[];
  return records.filter((record) => record.company_short_name && Number.isFinite(Number(record.gmp_perc)));
}

async function enrichIPOData(results: CompanyIPOData[]): Promise<CompanyIPOData[]> {
  const gmpRecords = await getGMPRecords();

  return results.map((ipo) => ({
    ...ipo,
    gmp_percentage: findGMPPercentage(ipo.name, gmpRecords),
  }));
}

// -------------------------------------------------------------
// Main Extraction Function
// -------------------------------------------------------------

/**
 * Parses Screener's upcoming IPO HTML page and extracts all structured company records.
 *
 * @param html The raw HTML string.
 * @returns Array of CompanyIPOData objects.
 */
function parseUpcomingIPOs($: cheerio.CheerioAPI): CompanyIPOData[] {
  const results: CompanyIPOData[] = [];

  const rows = $("table.data-table > tbody > tr");

  rows.each((_, tr) => {
    const $tr = $(tr);
    const $cols = $tr.children("td");

    // Guard against malformed or non-data rows
    if ($cols.length < 8) return;

    // Col 0: Name, URL, Company ID, and Exchange links
    const $nameCol = $cols.eq(0);
    const $companyLink = $nameCol.find("a[href^='/company/']").first();
    const name = $companyLink.text().trim();
    const url = $companyLink.attr("href") || null;
    const idMatch = url ? url.match(/\/company\/id\/(\d+)/) : null;
    const id = idMatch ? idMatch[1] : null;

    if (!id || !url || !name) return;

    const exchanges: ExchangeLink[] = [];
    $nameCol.find("a[href*='nseindia.com'], a[href*='bseindia.com']").each((_, el) => {
      const exchangeText = $(el).find("span").text().trim() || $(el).text().trim();
      const href = $(el).attr("href") || "";
      if (exchangeText && href) {
        exchanges.push({
          exchange: exchangeText,
          url: href,
        });
      }
    });

    // Col 1: Subscription Period
    const subscriptionPeriodRaw = $cols.eq(1).text().replace(/\s+/g, " ").trim();
    const subscription_period = parseSubscriptionPeriod(subscriptionPeriodRaw);

    // Col 2: Price Band
    const priceRaw = $cols.eq(2).text().trim();
    const price = parsePriceBand(priceRaw);

    // Col 3: Listing Date
    const listingDateRaw = $cols.eq(3).text().trim();
    const listing_date = listingDateRaw && listingDateRaw !== "-" ? parseDate(listingDateRaw) : null;

    // Col 4: Market Cap (Cr)
    const marketCapRaw = $cols.eq(4).text().trim();
    const market_cap_cr = parseNullableNumber(marketCapRaw) ?? 0;

    // Col 5: Total Subscription & Modal Breakdown
    const $subCol = $cols.eq(5);
    const totalSubText = $subCol.find("button").first().text().trim();
    const totalSubTimes = parseSubscriptionTimes(totalSubText);

    let breakdown: CategoryBreakdown | null = null;
    const $modalTable = $subCol.find(".dropdown-content table.data-table");

    if ($modalTable.length > 0) {
      breakdown = {
        institutional: null,
        non_institutional: null,
        retail: null,
        total: null,
      };

      $modalTable.find("tbody tr").each((_, rowEl) => {
        const $r = $(rowEl);
        const categoryLabel = $r.find("td.text").text().toLowerCase().trim();

        if (categoryLabel.includes("institutional") && !categoryLabel.includes("non-institutional")) {
          breakdown!.institutional = parseModalRow($r);
        } else if (categoryLabel.includes("non-institutional")) {
          breakdown!.non_institutional = {
            ...parseModalRow($r),
            above_10_lakh: null,
            from_2_to_10_lakh: null,
          };
        } else if (categoryLabel.includes("above") || categoryLabel.includes(">")) {
          if (breakdown!.non_institutional) {
            breakdown!.non_institutional.above_10_lakh = parseModalRow($r);
          }
        } else if (categoryLabel.includes("2–10") || categoryLabel.includes("2-10")) {
          if (breakdown!.non_institutional) {
            breakdown!.non_institutional.from_2_to_10_lakh = parseModalRow($r);
          }
        } else if (categoryLabel.includes("retail")) {
          breakdown!.retail = parseModalRow($r);
        }
      });

      const $tfootRow = $modalTable.find("tfoot tr").first();
      if ($tfootRow.length > 0) {
        breakdown.total = parseModalRow($tfootRow);
      }
    }

    // Col 6: P/E Ratio
    const peRaw = $cols.eq(6).text().trim();
    const pe = parseNullableNumber(peRaw) ?? 0;

    // Col 7: ROCE (%)
    const roceRaw = $cols.eq(7).text().trim();
    const roce_percentage = parseNullableNumber(roceRaw) ?? 0;

    results.push({
      id,
      name,
      url,
      exchanges,
      subscription_period,
      price,
      listing_date,
      market_cap_cr,
      subscription: {
        total_times: totalSubTimes,
        breakdown,
      },
      pe,
      roce_percentage,
      gmp_percentage: null,
    });
  });

  return results;
}

export async function ListUpcommingIpo() {
  try {
    const url = `${BASE_URL}/ipo`;
    const response = await sendReq(() => axios.get(url));
    const html = response.data;

    const mainHtml = cheerio.load(html);
    const pagination = mainHtml(".pagination > .flex-baseline.options > a");
    const visitedPages = new Set<number>([1]);

    const firstPageResults = parseUpcomingIPOs(mainHtml);
    const results: CompanyIPOData[] = firstPageResults.filter(hasCompleteIPOData);
    let canContinuePagination = results.length === firstPageResults.length;

    // Pagination
    if (!canContinuePagination) {
      return enrichIPOData(results);
    }

    for (let i = 0; i < pagination.length; i++) {
      if (!canContinuePagination) {
        break;
      }

      const el = pagination[i];
      const pageText = mainHtml(el).text().trim();
      if (!/^\d+$/.test(pageText)) continue;

      const pageNo = Number(pageText);
      if (pageNo <= 1 || visitedPages.has(pageNo)) continue;
      visitedPages.add(pageNo);

      console.log(`Page ${pageNo} running`)

      const url = `${BASE_URL}/ipo?page=${pageNo}`;
      const response = await sendReq(() => axios.get(url));
      const html = response.data;

      const $ = cheerio.load(html);
      const pageResults = parseUpcomingIPOs($);
      const completePageResults = pageResults.filter(hasCompleteIPOData);
      results.push(...completePageResults);

      if (completePageResults.length !== pageResults.length) {
        canContinuePagination = false;
        break;
      }
    }
    return enrichIPOData(results);
  } catch (error) {
    throw error;
  }
}
