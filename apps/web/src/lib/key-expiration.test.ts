import assert from "node:assert/strict";
import test from "node:test";
import { isKeyExpired, parseKeyCreation } from "./key-expiration.js";

test("key expiration is calculated server-side and never uses null", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  for (const days of [1, 7, 30, 90]) {
    const key = parseKeyCreation({ name: " Test ", expiration: `${days}d` }, now);
    assert.equal(key.name, "Test");
    assert.equal(key.expiresAt?.getTime(), now.getTime() + days * 86_400_000);
    assert.equal(isKeyExpired(key.expiresAt!.toISOString(), now.getTime()), false);
    assert.equal(isKeyExpired(key.expiresAt!.toISOString(), key.expiresAt!.getTime()), true);
  }
  assert.equal(parseKeyCreation({ name: "Test", expiration: "never" }, now).expiresAt, null);
  assert.equal(isKeyExpired(null), false);
});

test("key creation rejects malformed names and unsupported expiration choices", () => {
  for (const body of [null, [], {}, { name: 123, expiration: "1d" }, { name: " ", expiration: "never" }, { name: "x".repeat(81), expiration: "1d" }, { name: "Test", expiration: "yesterday" }, { name: "Test", expiration: 7 }]) {
    assert.throws(() => parseKeyCreation(body));
  }
});
