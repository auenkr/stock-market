/** Personal endpoints verified with Basic access on 2026-10-02. */
export const finedgeOnlyResources = new Set([
  "name-changes", "symbol-changes", "segment-revenue", "notes",
  "shareholdings/declaration", "shareholdings/beneficial-owners",
  "index/master", "index/market-price/daily-feed", "index/price-returns", "holidays-calendar",
]);

export const finedgeFallbackResources = new Set([
  ...finedgeOnlyResources, "financials", "ratios", "financial-metrics", "basic-financials",
  "investor-call-transcripts", "investor-presentations", "corp-announcements", "results-calendar",
]);
