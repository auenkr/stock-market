import assert from "node:assert/strict";
import test from "node:test";
import { billingConfig } from "./billing.js";

const complete = {
  POLAR_ACCESS_TOKEN: "fixture-token",
  POLAR_WEBHOOK_SECRET: "fixture-secret",
  POLAR_BASIC_PRODUCT_ID: "basic-product",
  POLAR_PERSONAL_PRODUCT_ID: "personal-product",
  POLAR_PROFESSIONAL_PRODUCT_ID: "professional-product",
  POLAR_ENVIRONMENT: "sandbox",
};

test("partial Vercel Preview billing configuration disables checkout", (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  assert.equal(billingConfig({ VERCEL_ENV: "preview", POLAR_ACCESS_TOKEN: "fixture-token", POLAR_WEBHOOK_SECRET: "fixture-secret" }), null);
  assert.equal(warning.mock.callCount(), 1);
});

test("partial production and local billing configurations still fail explicitly", () => {
  for (const environment of [undefined, "production", "development"]) {
    assert.throws(() => billingConfig({ VERCEL_ENV: environment, POLAR_ACCESS_TOKEN: "fixture-token" }), /both Polar credentials and all three product IDs/);
  }
});

test("billing stays optional when unset and complete preview settings enable it", () => {
  assert.equal(billingConfig({}), null);
  assert.equal(billingConfig({ VERCEL_ENV: "preview" }), null);
  const config = billingConfig({ ...complete, VERCEL_ENV: "preview" });
  assert.equal(config?.basic, "basic-product");
  assert.equal(config?.environment, "sandbox");
});

test("preview deployments still reject invalid environments and duplicate product IDs", () => {
  assert.throws(() => billingConfig({ ...complete, VERCEL_ENV: "preview", POLAR_ENVIRONMENT: "unknown" }), /POLAR_ENVIRONMENT/);
  assert.throws(() => billingConfig({ ...complete, VERCEL_ENV: "preview", POLAR_BASIC_PRODUCT_ID: complete.POLAR_PERSONAL_PRODUCT_ID }), /product IDs must be different/);
});
