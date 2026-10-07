/**
 * Rewrite verification runner. Points the black-box contract suite at an already
 * running server (for example the Rust service) backed by a migrated database.
 *
 * Usage:
 *   CONTRACT_BASE_URL=http://127.0.0.1:3000 \
 *   CONTRACT_DATABASE_URL=postgresql://.../db \
 *   CONTRACT_CACHE_ENABLED=true \
 *   CONTRACT_FIXTURE_SOURCE=1   # only if the server reads from fixture-server.mjs
 *   node --import tsx --test apps/api/tests/contract/run-external.ts
 */
import { after } from 'node:test';
import postgres from 'postgres';
import { defineContractSuite, seedKeys } from './suite.js';

const baseUrls = (process.env.CONTRACT_BASE_URL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (baseUrls.length === 0) throw new Error('Set CONTRACT_BASE_URL to the server under test');
if (!process.env.CONTRACT_DATABASE_URL) throw new Error('Set CONTRACT_DATABASE_URL for contract seeding');
const sql = postgres(process.env.CONTRACT_DATABASE_URL, { max: 4 });

await sql`INSERT INTO usage_policy (id, request_limit) VALUES ('default', 10000), ('personal', 10000), ('professional', 10000) ON CONFLICT (id) DO UPDATE SET request_limit = 10000`;
await defineContractSuite({
  baseUrls,
  sql,
  cacheEnabled: (process.env.CONTRACT_CACHE_ENABLED ?? 'true').toLowerCase() !== 'false',
  keys: await seedKeys(sql),
  flags: { fixtureSource: process.env.CONTRACT_FIXTURE_SOURCE === '1', multiInstance: baseUrls.length > 1, canBreakDatabase: false },
});
after(async () => { await sql.end({ timeout: 1 }); });
