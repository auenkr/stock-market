import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = fileURLToPath(new URL('../Cargo.toml', import.meta.url));
const binary = fileURLToPath(new URL('../target/release/api-rs', import.meta.url));
const databaseUrl = process.env.CONTRACT_DATABASE_URL;
if (!databaseUrl) throw new Error('Set CONTRACT_DATABASE_URL to a migrated, disposable PostgreSQL database');

const port = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return value;
};

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`)));
});

const start = (command, args, options = {}) => spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timeout);
};

const fixturePort = await port();
const apiPort = await port();
const fixtureUrl = `http://127.0.0.1:${fixturePort}`;
const baseUrl = `http://127.0.0.1:${apiPort}`;
let fixture;
let api;

try {
  await run('cargo', ['build', '--release', '--manifest-path', manifest]);
  fixture = start(process.execPath, ['apps/api/tests/contract/fixture-server.mjs', String(fixturePort)]);
  const env = {
    ...process.env,
    PORT: String(apiPort),
    ENVIRONMENT: 'dev',
    DATABASE_URL: databaseUrl,
    DB_POOL_MAX: '5',
    VALKEY_CACHE_PREFIX: process.env.VALKEY_CACHE_PREFIX ?? 'stock-market:rust-contract',
    SOURCE_BASE_URL: fixtureUrl,
    SOURCE_PACING_MS: '0',
  };
  api = start(binary, [], { env });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (fixture.exitCode !== null || api.exitCode !== null) throw new Error('Fixture source or Rust API exited before becoming ready');
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Rust API did not become ready at ${baseUrl}`);

  await run('pnpm', ['--filter', '@stock-market/api', 'test:contract:external'], {
    env: {
      ...env,
      CONTRACT_BASE_URL: baseUrl,
      CONTRACT_DATABASE_URL: databaseUrl,
      CONTRACT_CACHE_ENABLED: env.VALKEY_URL ? 'true' : 'false',
      CONTRACT_FIXTURE_SOURCE: '1',
    },
  });
} finally {
  await stop(api);
  await stop(fixture);
}
