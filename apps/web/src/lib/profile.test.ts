import assert from "node:assert/strict";
import test from "node:test";
import { validateProfileInput } from "./profile";
import { createProfilePostHandler } from "./profile-api";

test("profile validation trims names and optional company and enforces their limits", () => {
  assert.deepEqual(validateProfileInput({ name: "  Ada Lovelace  ", company: "  Example Ltd  " }), {
    ok: true, data: { name: "Ada Lovelace", company: "Example Ltd" },
  });
  assert.deepEqual(validateProfileInput({ name: "Ada", company: "  " }), {
    ok: true, data: { name: "Ada", company: null },
  });
  assert.deepEqual(validateProfileInput({ name: "Ada" }), { ok: true, data: { name: "Ada", company: null } });
  assert.equal(validateProfileInput({ name: "n".repeat(80), company: "c".repeat(120) }).ok, true);
  for (const input of [null, [], "Ada", {}, { name: "   " }, { name: 7 }, { name: "n".repeat(81) }, { name: "Ada", company: 7 }, { name: "Ada", company: "c".repeat(121) }]) {
    assert.equal(validateProfileInput(input).ok, false);
  }
});

const baseURL = "http://localhost:3001";
function request(body: unknown, origin: string | null = baseURL) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${baseURL}/api/profile`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("profile completion saves only validated fields against the authenticated user", async () => {
  const saved: unknown[] = [];
  const POST = createProfilePostHandler({
    baseURL, getUser: async () => ({ id: "signed-in-user" }),
    saveProfile: async (userId, profile) => { saved.push({ userId, profile }); return true; },
  });
  const response = await POST(request({
    name: "  Ada  ", company: "  Example  ", userId: "different-user", profileCompleted: false,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(saved, [{ userId: "signed-in-user", profile: { name: "Ada", company: "Example" } }]);
});

test("profile completion rejects missing sessions, invalid input, and cross-origin requests before saving", async () => {
  let saveCalls = 0;
  const POST = createProfilePostHandler({
    baseURL, getUser: async (headers) => headers.has("authorization") ? undefined : { id: "signed-in-user" },
    saveProfile: async () => { saveCalls++; return true; },
  });
  assert.equal((await POST(request({ name: "Ada" }, "https://attacker.example"))).status, 403);
  assert.equal((await POST(request({ name: "Ada" }, null))).status, 403);
  const crossSite = request({ name: "Ada" });
  crossSite.headers.set("sec-fetch-site", "cross-site");
  assert.equal((await POST(crossSite)).status, 403);
  const anonymous = request({ name: "Ada" });
  anonymous.headers.set("authorization", "anonymous-test");
  assert.equal((await POST(anonymous)).status, 401);
  assert.equal((await POST(request({ name: " " }))).status, 400);
  const malformed = new Request(`${baseURL}/api/profile`, { method: "POST", headers: { origin: baseURL }, body: "{bad-json" });
  assert.equal((await POST(malformed)).status, 400);
  assert.equal(saveCalls, 0);
});

test("profile completion allows the canonical origin behind a proxy and rejects deleted users", async () => {
  const POST = createProfilePostHandler({
    baseURL: "https://stocks.example.com", getUser: async () => ({ id: "deleted-user" }),
    saveProfile: async () => false,
  });
  assert.equal((await POST(request({ name: "Ada" }, "https://stocks.example.com"))).status, 401);
});
