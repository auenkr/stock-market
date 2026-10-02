import assert from "node:assert/strict";
import test from "node:test";
import { endpointCatalog } from "./endpoint-catalog.js";
import { openApi } from "./openapi.js";
import { createTestApp } from "./test-app.js";

test("every operation has a product tier and aliases preserve tier and API format", () => {
  const spec = openApi("http://localhost:8787");
  for (const [path, item] of Object.entries(spec.paths)) {
    const op = (item as any).get;
    assert(["free", "paid"].includes(op["x-tier"]), path);
    assert.deepEqual(op.tags, [op["x-tier"]], path);
    assert(["personal", "enterprise", "legacy", "service"].includes(op["x-api-style"]), path);
    if (op["x-alias"]) {
      const canonical = (spec.paths[op["x-canonical-path"]] as any).get;
      assert.equal(op["x-tier"], canonical["x-tier"], path);
      assert.equal(op["x-api-style"], canonical["x-api-style"], path);
    }
  }
  for (const path of ["/api/v1/company-profile/{symbol}", "/api/v1/basic-financials/{symbol}", "/api/v2/quote", "/v1/company-search", "/health", "/v1/coverage"])
    assert.equal((spec.paths[path] as any).get["x-tier"], "free", path);
  for (const path of ["/api/v1/financials/{symbol}", "/api/v1/shareholdings/pattern/{symbol}", "/v1/company-data", "/v1/extract", "/enterprise/api/company-profile"])
    assert.equal((spec.paths[path] as any).get["x-tier"], "paid", path);
  assert(endpointCatalog.filter((e) => e.apiStyle === "enterprise").every((e) => e.tier === "paid"));
  assert((spec.paths["/enterprise/api/company-profile"] as any).get.responses["200"].content["application/json"].schema.oneOf, "Batch response still supports objects and arrays");
  assert.deepEqual(endpointCatalog.find((e) => e.path === "/api/v1/segment-revenue/{symbol}")!.parameters.find((p) => p.name === "statement_code")!.schema.enum, ["pl", "bs"]);
});

test("coverage exposes the same tiers and formats as the catalog", async () => {
  const response = await createTestApp().request("/v1/coverage");
  assert.equal(response.status, 200);
  const coverage = await response.json<any>();
  for (const endpoint of endpointCatalog) {
    const entry = coverage.endpoints.find((e: any) => e.path === endpoint.path);
    assert.equal(entry.tier, endpoint.tier);
    assert.equal(entry.apiStyle, endpoint.apiStyle);
  }
});
