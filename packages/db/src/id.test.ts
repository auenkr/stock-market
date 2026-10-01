import assert from "node:assert/strict";
import test from "node:test";
import { validate, version } from "uuid";
import { createId } from "./id.js";

test("database IDs are unique UUIDv7 values ordered by generation time", () => {
  const ids = Array.from({ length: 1000 }, () => createId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.equal(validate(id), true);
    assert.equal(version(id), 7);
  }
  assert.deepEqual(ids, [...ids].sort());
});
