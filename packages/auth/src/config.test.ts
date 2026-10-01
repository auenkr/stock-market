import assert from "node:assert/strict";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthOptions } from "./config.js";

test("Google is enabled only with both credentials and auth origins follow the web port", () => {
  const defaults = createAuthOptions({});
  assert.equal(defaults.baseURL, "http://localhost:3001");
  assert.deepEqual(defaults.trustedOrigins, ["http://localhost:3001", "http://127.0.0.1:3001"]);
  assert.equal(defaults.socialProviders.google, undefined);
  assert.equal(createAuthOptions({ GOOGLE_CLIENT_ID: "client" }).socialProviders.google, undefined);
  assert.equal(createAuthOptions({ GOOGLE_CLIENT_SECRET: "secret" }).socialProviders.google, undefined);

  const configured = createAuthOptions({
    WEB_PORT: "4001", BETTER_AUTH_URL: "https://stocks.example.com",
    WEB_URL: " https://preview.example.com,https://stocks.example.com, ",
    GOOGLE_CLIENT_ID: " client ", GOOGLE_CLIENT_SECRET: " secret ",
    BETTER_AUTH_SECRET: "dedicated-session-secret", DB_CONNECTION_URL: "not-a-session-secret",
  });
  assert.equal(configured.baseURL, "https://stocks.example.com");
  assert.deepEqual(configured.socialProviders.google, { clientId: "client", clientSecret: "secret" });
  assert.deepEqual(configured.trustedOrigins, [
    "https://stocks.example.com", "http://localhost:4001", "http://127.0.0.1:4001", "https://preview.example.com",
  ]);
  assert.equal(configured.secret, "dedicated-session-secret");
  assert.equal(createAuthOptions({ NODE_ENV: "production", DB_CONNECTION_URL: "database-secret" }).secret, undefined);
});

function cookies(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

function assertUUIDv7Ids(rows: unknown[]) {
  for (const row of rows) {
    const id = (row as { id: string }).id;
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
}

test("Google OAuth sends new users to onboarding, preserves returnees, and keeps completion server-owned", async () => {
  const options = createAuthOptions({
    GOOGLE_CLIENT_ID: "test-google-client", GOOGLE_CLIENT_SECRET: "test-google-secret",
    BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  });
  const database = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    ...options, database: memoryAdapter(database),
    rateLimit: { enabled: false }, logger: { disabled: true },
  });
  const context = await auth.$context;
  const google = context.socialProviders.find((provider) => provider.id === "google");
  assert.ok(google);
  // Exercise Better Auth's real state, callback, account, user, and session handling
  // while replacing only the remote Google token exchange and profile fetch.
  google.validateAuthorizationCode = async () => ({ accessToken: "test-google-token" });
  google.getUserInfo = async () => ({
    user: { name: "Google Name", email: "new@example.com", emailVerified: true },
    data: { sub: "google-user-1", name: "Google Name", email: "new@example.com", email_verified: true },
  });

  async function signIn() {
    const start = await auth.handler(new Request(`${options.baseURL}/api/auth/sign-in/social`, {
      method: "POST", headers: { "content-type": "application/json", origin: options.baseURL },
      body: JSON.stringify({
        provider: "google", callbackURL: `${options.baseURL}/dashboard`,
        newUserCallbackURL: `${options.baseURL}/onboarding`, disableRedirect: true,
      }),
    }));
    assert.equal(start.status, 200);
    const authorization = new URL((await start.json() as { url: string }).url);
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(authorization.searchParams.get("redirect_uri"), `${options.baseURL}/api/auth/callback/google`);
    assert.ok(authorization.searchParams.get("state"));
    assert.ok(database.verification.length > 0);
    assertUUIDv7Ids(database.verification);
    const callback = new URL(`${options.baseURL}/api/auth/callback/google`);
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.searchParams.set("code", "test-authorization-code");
    return auth.handler(new Request(callback, { headers: { cookie: cookies(start) } }));
  }

  const first = await signIn();
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("location"), `${options.baseURL}/onboarding`);
  const firstSession = await auth.api.getSession({ headers: new Headers({ cookie: cookies(first) }) });
  assert.ok(firstSession);
  assert.equal(firstSession.user.profileCompleted, false);
  assert.equal(database.user.length, 1);
  assertUUIDv7Ids(database.user);
  assertUUIDv7Ids(database.account);
  assertUUIDv7Ids(database.session);

  for (const [model, rows] of Object.entries(database)) {
    // OAuth state verification is consumed by callback, so create one persisted
    // verification separately below before asserting all model IDs together.
    if (model !== "verification") assert.ok(rows.length > 0, `${model} was created`);
    for (const row of rows as { id: string }[]) {
      assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, `${model} ID is UUIDv7`);
    }
  }
  const verification = await context.internalAdapter.createVerificationValue({
    identifier: "test-verification", value: "test-value", expiresAt: new Date(Date.now() + 60_000),
  });
  assert.ok(verification);
  assert.match(verification.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const forgedUpdate = await auth.handler(new Request(`${options.baseURL}/api/auth/update-user`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: options.baseURL, cookie: cookies(first) },
    body: JSON.stringify({ name: "Forged Completion", profileCompleted: true }),
  }));
  assert.equal(forgedUpdate.status, 400);
  assert.equal((await auth.api.getSession({ headers: new Headers({ cookie: cookies(first) }) }))?.user.profileCompleted, false);

  const returning = await signIn();
  assert.equal(returning.status, 302);
  assert.equal(returning.headers.get("location"), `${options.baseURL}/dashboard`);
  assert.equal(database.user.length, 1);
  assert.equal((await auth.api.getSession({ headers: new Headers({ cookie: cookies(returning) }) }))?.user.profileCompleted, false);

  await context.internalAdapter.updateUser(firstSession.user.id, {
    name: "Ada Lovelace", company: "Example Ltd", profileCompleted: true,
  });
  const completed = await signIn();
  const completedSession = await auth.api.getSession({ headers: new Headers({ cookie: cookies(completed) }) });
  assert.equal(completed.headers.get("location"), `${options.baseURL}/dashboard`);
  assert.equal(completedSession?.user.profileCompleted, true);
  assert.equal(completedSession?.user.name, "Ada Lovelace");
  assert.equal(completedSession?.user.company, "Example Ltd");
  assert.equal(database.user.length, 1);
});

test("email signup also starts incomplete even if the caller sends a forged completion flag", async () => {
  const options = createAuthOptions({ BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters" });
  const auth = betterAuth({
    ...options, database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    rateLimit: { enabled: false }, logger: { disabled: true },
  });
  const response = await auth.handler(new Request(`${options.baseURL}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: options.baseURL },
    body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "test-password-for-signup", profileCompleted: true }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { user: { profileCompleted: boolean } }).user.profileCompleted, false);
});
