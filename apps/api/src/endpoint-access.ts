import { DataError } from "./screener-provider.js";
import type { ApiPlan } from "@stock-market/db/account-access";
import type { SourceCache } from "@stock-market/scraper/utils/cache";

export type AccessVariables = { apiPlan: ApiPlan; sourceCache?: SourceCache };
// Top five by market capitalization at 2026-10-01 close. A versioned product
// allowlist keeps access predictable; update this list and docs together.
export const freeCompanySymbols = ["RELIANCE", "HDFCBANK", "BHARTIARTL", "ICICIBANK", "SBIN"] as const;
export const freeCompaniesAsOf = "2026-10-01";
export function requireCompanyAccess(plan: ApiPlan, symbols: string[]) {
  if (plan === "free" && symbols.some((symbol) => !freeCompanySymbols.some((allowed) => symbol === allowed || symbol.replace(/\/$/, "").toUpperCase() === `/COMPANY/${allowed}` || symbol.replace(/\/$/, "").toUpperCase() === `/COMPANY/${allowed}/CONSOLIDATED`))) {
    throw new DataError(`Free company endpoints are limited to ${freeCompanySymbols.join(", ")}. Upgrade to access other companies.`, 403, "FREE_COMPANY_RESTRICTED");
  }
}
