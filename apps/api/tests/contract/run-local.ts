// Self-contained runner: disposable database + fixture source + two real API
// instances, then the black-box contract suite. Invoked via run.mjs contract mode.
import { after } from 'node:test';
import { db } from '@stock-market/db';
import { setup } from '../harness.js';
import { defineContractSuite, seedKeys } from './suite.js';

const fixture = await setup();
const ctx = {
  baseUrls: fixture.urls,
  sql: fixture.sql,
  cacheEnabled: fixture.bindings.CACHE_ENABLED === 'true',
  keys: await seedKeys(fixture.sql),
  flags: { fixtureSource: true, multiInstance: true, canBreakDatabase: true, startApi: (env: Record<string, string | undefined>) => fixture.startApi({ ...fixture.bindings, ...env }) },
  sourceRequests: () => fixture.requests,
};
await defineContractSuite(ctx);
after(async () => { try { await fixture?.cleanup(); } finally { await db.$client.end({ timeout: 1 }); } });
