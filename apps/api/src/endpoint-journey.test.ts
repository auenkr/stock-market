import assert from "node:assert/strict";
import test from "node:test";
import { endpointJourney, endpointOrder, endpointUseCase, userJourney } from "./endpoint-journey.js";
import { endpointCatalog } from "./endpoint-catalog.js";
import { openApi } from "./openapi.js";
import { createTestApp } from "./test-app.js";

test("the company journey classifies every endpoint once and orders all formats together", () => {
  const paths = endpointJourney.flatMap((group) => [...group.paths]);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(userJourney.map((group) => group.id), ["company-search", "company-overview", "finance", "internal"]);
  const spec = openApi("http://localhost:8787", "dev");
  assert.deepEqual(spec["x-user-journey"], userJourney);
  const operations = Object.entries(spec.paths).map(([path, item]) => ({ path, op: (item as any).get }));
  assert.equal(operations[0]!.path, "/v1/company-search");
  assert.deepEqual(operations.map(({ op }) => op["x-order"]), operations.map(({ op }) => op["x-order"]).sort((a, b) => a - b));
  for (const { path, op } of operations) {
    const canonical = op["x-canonical-path"] ?? path;
    assert.equal(op["x-use-case"], endpointUseCase(canonical).id, path);
    assert.equal(op["x-order"], endpointOrder(canonical), path);
    assert.deepEqual(op.tags, [endpointUseCase(canonical).title], path);
    if (op["x-alias"]) assert.equal((spec.paths[canonical] as any).get["x-use-case"], op["x-use-case"], path);
  }
  assert.deepEqual(endpointCatalog.map((endpoint) => endpointOrder(endpoint.path)), endpointCatalog.map((endpoint) => endpointOrder(endpoint.path)).sort((a, b) => a - b));
  for (const path of paths) assert(endpointCatalog.some((endpoint) => endpoint.path === path) || spec.paths[path], path);
});

test("coverage publishes the same journey and ordered endpoint classifications", async () => {
  const coverage = await (await createTestApp().request("/v1/coverage")).json<any>();
  assert.deepEqual(coverage.userJourney, userJourney);
  assert.deepEqual(coverage.endpoints.map((endpoint: any) => endpoint.path), endpointCatalog.map((endpoint) => endpoint.path));
  for (const endpoint of coverage.endpoints) {
    assert.equal(endpoint.useCase, endpointUseCase(endpoint.path).id);
    assert.equal(endpoint.order, endpointOrder(endpoint.path));
  }
});
