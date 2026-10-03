import assert from "node:assert/strict";
import test from "node:test";
import { billingConfig } from "./billing.js";

const complete = {
  POLAR_ACCESS_TOKEN: "fixture-token",
  POLAR_WEBHOOK_SECRET: "fixture-secret",
  POLAR_SANDBOX_BASIC_PRODUCT_ID: "basic-product",
  POLAR_SANDBOX_PERSONAL_PRODUCT_ID: "personal-product",
  POLAR_SANDBOX_PROFESSIONAL_PRODUCT_ID: "professional-product",
  ENVIRONMENT: "dev",
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
  assert.throws(() => billingConfig({ ...complete, VERCEL_ENV: "preview", ENVIRONMENT: "staging" }), /ENVIRONMENT must be dev or production/);
  assert.throws(() => billingConfig({ ...complete, VERCEL_ENV: "preview", POLAR_SANDBOX_BASIC_PRODUCT_ID: complete.POLAR_SANDBOX_PERSONAL_PRODUCT_ID }), /product IDs must be different/);
});

test("ENVIRONMENT selects the matching Polar catalog and API", () => {
  const config = billingConfig({ ...complete, ENVIRONMENT: "production", POLAR_PRODUCTION_BASIC_PRODUCT_ID: "prod-basic", POLAR_PRODUCTION_PERSONAL_PRODUCT_ID: "prod-personal", POLAR_PRODUCTION_PROFESSIONAL_PRODUCT_ID: "prod-professional" });
  assert.equal(config?.environment, "production");
  assert.equal(config?.basic, "prod-basic");
});

test("missing product IDs default to the catalog selected by ENVIRONMENT", () => {
  const sandbox = billingConfig({ POLAR_ACCESS_TOKEN: "fixture-token", POLAR_WEBHOOK_SECRET: "fixture-secret", ENVIRONMENT: "dev" });
  const production = billingConfig({ POLAR_ACCESS_TOKEN: "fixture-token", POLAR_WEBHOOK_SECRET: "fixture-secret", ENVIRONMENT: "production" });
  assert.equal(sandbox?.basic, "64c26c52-74bb-4f3f-8025-66e9d2c62637");
  assert.equal(sandbox?.environment, "sandbox");
  assert.equal(production?.basic, "9e5e9c9a-3b60-42b2-b7ab-f6e769ad5ed8");
  assert.equal(production?.environment, "production");
});
