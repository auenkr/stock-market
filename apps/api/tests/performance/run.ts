import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../harness.js';

const fixture = await setup();
let child: ReturnType<typeof spawn> | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child?.kill(signal));
try {
  const mode = process.env.SCENARIO ?? 'smoke';
  await fixture.sql`UPDATE usage_policy SET request_limit = ${mode === 'quota' ? 10 : 1000000} WHERE id = 'paid'`;
  const quotaOwner = await fixture.account();
  const keys = [await fixture.key(quotaOwner), await fixture.key(quotaOwner)];
  const results = fileURLToPath(new URL('./results/', import.meta.url));
  await mkdir(results, { recursive: true });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child = spawn('k6', ['run', fileURLToPath(new URL('./api.k6.js', import.meta.url))], {
      stdio: 'inherit', env: { ...process.env, SCENARIO: mode, BASE_URL: fixture.urls[0], API_KEY: fixture.secret, QUOTA_KEY: keys[0], QUOTA_KEY_2: keys[1], COLD_SOURCE: process.env.COLD_SOURCE ?? '1', SUMMARY_PATH: `${results}${mode}.json` },
    });
    child.on('error', reject); child.on('exit', resolve);
  });
  if (exitCode !== 0) process.exitCode = 1;
} finally { await fixture.cleanup(); }
