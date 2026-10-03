import assert from "node:assert/strict";
import test from "node:test";
import { openApi } from "./openapi.js";
import { createTestApp } from "./test-app.js";

test("Internal operations and their unused schemas are documented only in explicit dev mode", () => {
  for (const environment of [undefined, "production", "prod", "test", "DEV", ""]) {
    const spec = openApi("http://localhost", environment);
    const schemas = spec.components.schemas as Record<string, unknown>;
    assert(!Object.values(spec.paths).some((entry: any) => entry.get["x-use-case"] === "internal"));
    assert(!spec.tags.some((tag) => tag.name === "Internal"));
    assert(!spec["x-user-journey"].some((group) => group.id === "internal"));
    assert.equal(schemas.LegacyCompanyData, undefined);
    assert(spec.paths["/v1/list-of-company"]); assert(spec.paths["/api/v1/shareholdings/distribution"]);
    function refs(value: any) {
      if (!value || typeof value !== "object") return;
      if (value.$ref) assert(schemas[value.$ref.split("/").at(-1)!], value.$ref);
      Object.values(value).forEach(refs);
    }
    refs(spec.paths);
  }
  const dev = openApi("http://localhost", "dev");
  assert(dev.paths["/v1/list-of-ipo"]); assert((dev.components.schemas as Record<string, unknown>).LegacyCompanyData);
});

test("Worker environment gates both contracts while retaining authenticated Internal routes", async () => {
  const app = createTestApp(() => ({ execute: async (_, query) => ({ body: { symbol: query.symbol } }) }));
  for (const environment of ["production", "dev"]) {
    for (const route of ["/swagger.json", "/openapi.json"]) {
      const spec = await (await app.request(route, {}, { ENVIRONMENT: environment })).json<any>();
      assert.equal(Boolean(spec.paths["/v1/results-calendar"]), environment === "dev");
      assert.equal(Boolean(spec.paths["/v1/company-data"]), environment === "dev");
    }
    const home = await (await app.request("/", {}, { ENVIRONMENT: environment })).text();
    assert.equal(home.includes("/v1/list-of-ipo"), environment === "dev");
    assert(home.includes("/v1/list-of-company"));
    assert.equal((await app.request("/v1/dividend?symbol=/company/ACME/", {}, { ENVIRONMENT: environment })).status, 200);
  }
});
