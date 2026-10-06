/** Product API sections; supplementary endpoints remain available under Internal. */
export const endpointJourney = [
  { id: "company-search", title: "Search", description: "Search by company name or browse the paginated company list. Both return the original company URL path as symbol.", paths: ["/v1/company-search", "/v1/list-of-company"] },
  { id: "company-overview", title: "Company overview", description: "Company profile, basic finance, business description, analysis, and documents.", paths: ["/api/v1/company-profile", "/api/v1/basic-financials", "/api/v1/company-documents"] },
  { id: "finance", title: "Finance", description: "Peer comparison, quarterly and annual profit and loss, balance sheet, cash flow, ratios, shareholding pattern and distribution. Only symbol is required; its URL selects standalone or consolidated data.", paths: ["/api/v1/peer-comparison", "/api/v1/quarterly-profit-loss", "/api/v1/profit-loss", "/api/v1/balance-sheet", "/api/v1/cash-flow", "/api/v1/ratios", "/api/v1/shareholding-pattern", "/api/v1/shareholdings/distribution"] },
  { id: "screening", title: "Screening", description: "Run a custom company query and receive matching companies with the selected column values.", paths: ["/api/v1/screen"] },
  { id: "internal", title: "Internal", description: "Supplementary ownership, corporate actions, results calendar, upcoming IPOs, full-company extraction, and service endpoints. Documented only in dev mode.", paths: [
    "/api/v1/daily-price-ratios", "/api/v1/annual-price-ratios",
    "/api/v1/shareholdings/summary", "/api/v1/shareholdings/ownership-current", "/api/v1/shareholdings/ownership-history",
    "/api/v1/corporate-actions", "/api/v1/dividend", "/api/v1/corporate-actions/all",
    "/api/v1/results-calendar", "/v1/list-of-ipo",
    "/api/v1/index/market-price/historical", "/api/v1/index/valuation/historical", "/api/v1/commodity-price/{code}",
    "/v1/company-data", "/v1/extract", "/health", "/v1/coverage",
  ] },
] as const;

const orderedPaths = endpointJourney.flatMap((group) => [...group.paths]);
export const userJourney = endpointJourney.map(({ paths: _, ...group }, index) => ({ ...group, order: index + 1 }));
export function endpointUseCase(path: string) {
  const group = endpointJourney.find((entry) => (entry.paths as readonly string[]).includes(path));
  if (!group) throw new Error(`Endpoint has no user-journey classification: ${path}`);
  return group;
}
export function endpointOrder(path: string) {
  endpointUseCase(path);
  return (orderedPaths as readonly string[]).indexOf(path) + 1;
}
