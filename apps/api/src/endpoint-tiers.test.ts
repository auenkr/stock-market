import assert from "node:assert/strict";
import test from "node:test";
import { endpointCatalog } from "./endpoint-catalog.js";
import { openApi } from "./openapi.js";
import { createTestApp } from "./test-app.js";
import { endpointUseCase } from "./endpoint-journey.js";

test("every operation has a product tier and aliases preserve tier and API format", () => {
  const spec = openApi("http://localhost:8787", "dev");
  for (const [path, item] of Object.entries(spec.paths)) {
    const op = (item as any).get;
    assert(["free", "paid"].includes(op["x-tier"]), path);
    assert.deepEqual(op.tags, [endpointUseCase(op["x-canonical-path"] ?? path).title], path);
    assert(["personal", "legacy", "service"].includes(op["x-api-style"]), path);
    if (op["x-alias"]) {
      const canonical = (spec.paths[op["x-canonical-path"]] as any).get;
      assert.equal(op["x-tier"], canonical["x-tier"], path);
      assert.equal(op["x-api-style"], canonical["x-api-style"], path);
    }
  }
  for (const path of ["/api/v1/company-profile", "/api/v1/basic-financials", "/api/v1/peer-comparison", "/v1/company-search", "/health", "/v1/coverage"])
    assert.equal((spec.paths[path] as any).get["x-tier"], "free", path);
  for (const path of ["/api/v1/profit-loss", "/api/v1/shareholding-pattern", "/api/v1/company-documents", "/v1/company-data", "/v1/extract"])
    assert.equal((spec.paths[path] as any).get["x-tier"], "paid", path);
  assert(!Object.keys(spec.paths).some((path) => path.startsWith("/enterprise/")));
  assert.equal(endpointUseCase("/api/v1/shareholdings/distribution").id, "finance");
  assert.deepEqual(endpointCatalog.find((e) => e.resource === "shareholdings/distribution")!.parameters.map((parameter) => parameter.name), ["symbol"]);
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
