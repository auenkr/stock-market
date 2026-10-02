import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL as NodeURL } from "node:url";
import axios, { AxiosError } from "axios";
import { createTestApp as createApp } from "./test-app.js";
import { ScreenerProvider } from "./screener-provider.js";

const fixture = readFileSync(new NodeURL("./fixtures/company.html", import.meta.url), "utf8");
const company = fixture.replace(/<section id="(?:profit-loss|quarters|balance-sheet|cash-flow|ratios|quarterly-shp)">[\s\S]*?<\/section>/g, "");
const directory = '<table class="data-table"><tbody><tr data-row-company-id="42"><td>1</td><td><a href="/company/ACME/">Acme</a></td>' + Array.from({ length: 9 }, () => '<td>1,234.5</td>').join('') + '</tr></tbody></table>';

function withAdapter(adapter: NonNullable<typeof axios.defaults.adapter>, task: () => Promise<void>) {
  const previous = axios.defaults.adapter;
  axios.defaults.adapter = adapter;
  return task().finally(() => { axios.defaults.adapter = previous; });
}

test("legacy routes use Worker bindings for every source request and keep the response contracts", async () => {
  const requests: string[] = [];
  await withAdapter(async (config) => {
    const url = new URL(config.url!); requests.push(url.href);
    assert.equal(config.fetchOptions?.cache, "no-store");
    assert.equal(config.timeout, 15_000);
    if (url.hostname === "source.example") assert.equal(config.headers.get("Cookie"), "sessionid=test-only");
    else assert(!config.headers.get("Cookie"), "Source cookie must not be sent to supplementary providers");
    const data = url.pathname.includes("search") ? [{ name: "Acme", url: "/company/ACME/" }]
      : url.pathname.startsWith("/screens/") ? directory
      : url.pathname.startsWith("/ipo") ? '<table class="data-table"><tbody></tbody></table>'
      : url.hostname === "www.moneycontrol.com" ? []
      : url.pathname.startsWith("/api/") ? "<table></table>" : company;
    return { data, status: 200, statusText: "OK", headers: {}, config };
  }, async () => {
    const app = createApp();
    const bindings = { BASE_URL: "https://source.example", COOKIE: "sessionid=test-only" };
    const spec = await (await app.request("/swagger.json")).json<any>();
    function assertEnvelope(path: string, body: Record<string, unknown>) {
      const schema = spec.paths[path].get.responses["200"].content["application/json"].schema;
      assert.deepEqual(Object.keys(body).sort(), Object.keys(schema.properties).sort(), `${path}: Swagger must describe every returned envelope field`);
      for (const name of schema.required) assert(name in body, `${path}: missing required field ${name}`);
    }
    for (const prefix of ["/api", "/v1"]) {
      const list = await app.request(`${prefix}/list-of-company?page=2`, {}, bindings);
      assert.equal(list.status, 200);
      const body = await list.json<any>();
      assert.equal(body.data[0].cmp, 1234.5); assert.equal(body.meta.currentPage, 2);
      assert.deepEqual(Object.keys(body), ["meta", "data"]);
      assertEnvelope(`${prefix}/list-of-company`, body);
      const search = await app.request(`${prefix}/company-search?q=acme`, {}, bindings);
      const searchBody = await search.json<any>();
      assert.equal(search.status, 200); assert.equal(searchBody.results.length, 1); assertEnvelope(`${prefix}/company-search`, searchBody);
      const ipo = await app.request(`${prefix}/list-of-ipo`, {}, bindings);
      const ipoBody = await ipo.json<any>();
      assert.equal(ipo.status, 200); assert.deepEqual(ipoBody.ipos, []); assertEnvelope(`${prefix}/list-of-ipo`, ipoBody);
      const full = await app.request(`${prefix}/company-data?companyUrl=/company/ACME/consolidated/`, {}, bindings);
      const fullBody = await full.json<any>();
      assert.equal(full.status, 200); assert.equal(fullBody.companyData.name, "Acme Ltd"); assert.deepEqual(fullBody.data, fullBody.companyData); assertEnvelope(`${prefix}/company-data`, fullBody);
      const companySchema = spec.components.schemas.LegacyCompanyData;
      assert.deepEqual(Object.keys(fullBody.data).sort(), Object.keys(companySchema.properties).sort());
      assert.deepEqual(fullBody.data.metrics, []); assert.equal(companySchema.properties.metrics.maxItems, 0);
      assert(full.headers.get("X-Request-ID")); assert.equal(full.headers.get("Cache-Control"), "no-store");
      const extracted = await app.request(`${prefix}/extract?endpoint=/company/ACME/consolidated/&type=ratios`, {}, bindings);
      assert.equal(extracted.status, 200); assert.equal(extracted.headers.get("X-Cache"), "HIT");
      assertEnvelope(`${prefix}/extract`, await extracted.json<any>());
    }
    assert(requests.includes("https://source.example/company/ACME/consolidated/"));
    assert(!requests.includes("https://source.example/company/ACME/"));
    assert(requests.some((url) => url.includes("limit=100&page=2")));
    assert(requests.every((url) => !url.includes("/chart/")));
  });
});

test("source auth failures and upstream HTTP errors have useful codes and correlated logs without credentials", async () => {
  const lines: string[] = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  for (const level of ["info", "warn", "error"] as const) console[level] = (...values) => { lines.push(values.join(" ")); };
  try {
    await withAdapter(async (config) => ({ data: '<title>Register - Screener</title>', status: 200, statusText: "OK", headers: {}, config }), async () => {
      const response = await createApp().request("/api/list-of-company", {}, { COOKIE: "secret-cookie-never-log" });
      assert.equal(response.status, 502); assert.equal((await response.json<any>()).code, "SOURCE_AUTH_REQUIRED");
      const requestId = response.headers.get("X-Request-ID"); assert(requestId);
      assert(lines.some((line) => JSON.parse(line).event === "api.request.failed" && JSON.parse(line).requestId === requestId));
    });
    for (const status of [403, 404]) {
      await withAdapter(async (config) => { throw new AxiosError("Request failed", "ERR_BAD_REQUEST", config, undefined, { status, statusText: "failure", headers: {}, config, data: "secret-cookie-never-log" }); }, async () => {
        const response = await createApp().request("/api/company-search?q=acme", {}, { COOKIE: "secret-cookie-never-log" });
        assert.equal(response.status, status === 404 ? 404 : 502);
      });
    }
    assert(lines.every((line) => !line.includes("secret-cookie-never-log")));
    assert(lines.some((line) => line.includes('"upstreamStatus":403')));
  } finally { Object.assign(console, original); }
});

test("default provider calls native fetch with its global receiver", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async function () {
    assert.equal(this, globalThis, "Workers rejects an incorrect native fetch receiver");
    return new Response(fixture);
  };
  try {
    const provider = new ScreenerProvider();
    assert.equal((await provider.snapshot("ACME")).name, "Acme Ltd");
  } finally { globalThis.fetch = previous; }
});

test("optional news failures preserve the main company response", async () => {
  await withAdapter(async (config) => {
    if (config.url?.includes("moneycontrol")) throw new AxiosError("Forbidden", "ERR_BAD_REQUEST", config, undefined, { status: 403, statusText: "Forbidden", headers: {}, config, data: "" });
    return { data: config.url?.includes("/api/") ? "<table></table>" : company, status: 200, statusText: "OK", headers: {}, config };
  }, async () => {
    const response = await createApp().request("/api/company-data?companyUrl=/company/ACME/consolidated/", {}, { BASE_URL: "https://optional-news.example", COOKIE: "" });
    assert.equal(response.status, 200); assert.deepEqual((await response.json<any>()).data.news, []);
  });
});


test("company-data requires companyUrl and documents the original source path", async () => {
  let calls = 0;
  await withAdapter(async () => { calls += 1; throw new Error("Invalid paths must not fetch upstream"); }, async () => {
    const app = createApp();
    for (const prefix of ["/api", "/v1"]) {
      for (const query of ["", "?companyUrl=", "?companyUrl=%20", "?symbol=RELIANCE", "?endpoint=/company/RELIANCE/", "?companyUrl=https://example.com/company/ACME/", "?companyUrl=//example.com/company/ACME/", "?companyUrl=/company/../ACME/", "?companyUrl=/company/id/not-a-number/", "?companyUrl=/api/company/search/", "?companyUrl=/company/ACME/%3Fx=1"]) {
        assert.equal((await app.request(`${prefix}/company-data${query}`, { headers: { "X-API-Key": crypto.randomUUID() } })).status, 400, query);
      }
    }
    assert.equal(calls, 0);
    const spec = await (await app.request("/openapi.json")).json<any>();
    for (const path of ["/api/company-data", "/v1/company-data"]) {
      const parameters = spec.paths[path].get.parameters;
      assert.deepEqual(parameters.map((p: { name: string }) => p.name), ["companyUrl"]);
      assert.equal(parameters[0].required, true);
      assert.equal(parameters[0].example, "/company/id/1286218/");
    }
  });
});

test("company-data preserves ID, standalone, consolidated and ampersand company paths", async () => {
  const urls: string[] = [];
  await withAdapter(async (config) => {
    urls.push(config.url!);
    return { data: config.url?.includes("moneycontrol") ? [] : config.url?.includes("/api/") ? "<table></table>" : company, status: 200, statusText: "OK", headers: {}, config };
  }, async () => {
    const app = createApp();
    for (const prefix of ["/api", "/v1"]) {
      for (const companyUrl of ["/company/id/1286218/", "/company/id/1286218/consolidated/", "/company/ACME/", "/company/ACME/consolidated/", "/company/GVT&D/", "/company/M%26M/consolidated/"]) {
        const query = new URLSearchParams({ companyUrl });
        const response = await app.request(`${prefix}/company-data?${query}`, { headers: { "X-API-Key": crypto.randomUUID() } }, { BASE_URL: "https://path-test.example", COOKIE: "" });
        assert.equal(response.status, 200, companyUrl);
        assert(urls.includes(new URL(companyUrl, "https://path-test.example").href), companyUrl);
      }
    }
  });
});


test("company list returns original URLs without symbols and source-based pagination", async () => {
  let sourceHtml = directory;
  let calls = 0;
  await withAdapter(async (config) => {
    calls += 1;
    return { data: sourceHtml, status: 200, statusText: "OK", headers: {}, config };
  }, async () => {
    const app = createApp();
    // Pagination and input cases must not consume one shared rate-limit bucket.
    const request = (path: string) => app.request(path, { headers: { "X-API-Key": crypto.randomUUID() } });
    for (const prefix of ["/v1", "/api"]) {
      for (const [page, links, expectedNext] of [
        [1, '<div class="pagination"><a href="?page=2">Next</a><a href="?page=8">Last</a></div>', 2],
        [2, '<div class="paginator"><a href="?page=1">Previous</a><a href="?page=3">Next</a></div>', 3],
        [3, '<div class="pagination"><a href="?page=2">Previous</a></div>', null],
      ] as const) {
        const rows = directory.replace('/company/ACME/', '/company/ACME/consolidated/');
        sourceHtml = rows + links;
        const response = await request(`${prefix}/list-of-company?page=${page}`);
        assert.equal(response.status, 200);
        const body = await response.json<any>();
        assert.equal(body.data[0].url, "/company/ACME/consolidated/");
        assert(!("symbol" in body.data[0]));
        assert(!("skip" in body.data[0]));
        assert.equal(Object.keys(body)[0], "meta");
        assert.deepEqual(Object.keys(body), ["meta", "data"]);
        const expected = { currentPage: page, limit: 100, count: 1,
          isNextPageAvailable: expectedNext !== null, nextPage: expectedNext,
          previousPage: page > 1 ? page - 1 : null };
        assert.deepEqual(body.meta, expected);
      }
      // A full final page must not imply that another page exists.
      sourceHtml = directory.repeat(100);
      const full = await (await request(`${prefix}/list-of-company?page=4`)).json<any>();
      assert.equal(full.meta.count, 100);
      assert.equal(full.meta.isNextPageAvailable, false);
      assert.equal(full.meta.nextPage, null);
      sourceHtml = directory.replace('/company/ACME/', '/company/id/1286218/');
      const special = await (await request(`${prefix}/list-of-company`)).json<any>();
      assert.equal(special.data[0].url, "/company/id/1286218/");
      assert(!("symbol" in special.data[0]));
      const callsBefore = calls;
      for (const page of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
        assert.equal((await request(`${prefix}/list-of-company?page=${page}`)).status, 400);
      }
      assert.equal(calls, callsBefore);
    }
    const spec = await (await app.request("/swagger.json")).json<any>();
    assert("url" in spec.components.schemas.LegacyDirectoryCompany.properties);
    assert(!("symbol" in spec.components.schemas.LegacyDirectoryCompany.properties));
    assert(!("skip" in spec.components.schemas.LegacyDirectoryCompany.properties));
  });
});
