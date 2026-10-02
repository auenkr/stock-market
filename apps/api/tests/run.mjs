// Own a disposable PostgreSQL cluster/database; never load the application's .env.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const mode = process.argv[2] ?? 'integration';
const brewPrefix = spawnSync('brew', ['--prefix', 'postgresql@17'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const pgBin = process.env.POSTGRES_BIN ?? (brewPrefix.status === 0 ? join(brewPrefix.stdout.trim(), 'bin') : '');
const pgTool = name => pgBin ? join(pgBin, name) : name;
if (!['integration', 'performance'].includes(mode)) throw new Error('Use integration or performance');
const database = `stock_test_${process.pid}_${Date.now()}`;
let directory, container, admin, child, clusterStarted = false;
const port = async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
};
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal));
try {
  let adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    const databasePort = await port();
    if (spawnSync(pgTool('postgres'), ['--version'], { stdio: 'ignore' }).status === 0) {
      directory = await mkdtemp(join(tmpdir(), 'stock-market-tests-'));
      await run(pgTool('initdb'), [...(brewPrefix.status === 0 && !process.env.POSTGRES_BIN ? ['-L', join(brewPrefix.stdout.trim(), 'share/postgresql')] : []), '-D', directory, '-U', 'stock_test', '-A', 'trust', '--no-locale']);
      await run(pgTool('pg_ctl'), ['-D', directory, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${databasePort} -k ${directory}`, '-w', 'start']);
      clusterStarted = true;
    } else {
      container = database;
      await run('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_USER=stock_test', '-e', 'POSTGRES_PASSWORD=stock_test', '-p', `127.0.0.1:${databasePort}:5432`, 'postgres:17-alpine']);
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'stock_test'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!ready) throw new Error('Test PostgreSQL did not become ready');
    }
    adminUrl = `postgresql://stock_test:stock_test@127.0.0.1:${databasePort}/postgres`;
  }
  admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${database}"`);
  const url = new URL(adminUrl); url.pathname = `/${database}`;
  const env = { ...process.env, DB_CONNECTION_URL: url.href, INTEGRATION_DATABASE_URL: url.href };
  await run('pnpm', ['--filter', '@stock-market/db', 'build'], env);
  await run('pnpm', ['--filter', '@stock-market/common', 'build'], env);
  await run('pnpm', ['--filter', '@stock-market/scraper', 'build'], env);
  // Apply the real application schema, including auth and foreign keys.
  await run('pnpm', ['--filter', '@stock-market/web', 'exec', 'drizzle-kit', 'push', '--force'], env);
  await run('node', ['--import', 'tsx', ...(mode === 'integration' ? ['--test', '--test-timeout=60000', 'apps/api/tests/integration/api.test.ts'] : ['apps/api/tests/performance/run.ts'])], env);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  try {
    if (admin) {
      try { await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); }
      finally { await admin.end({ timeout: 1 }); }
    }
  } catch {
    console.error('Disposable database cleanup failed'); process.exitCode = 1;
  } finally {
    if (directory) {
      if (clusterStarted) {
        const stopped = spawnSync(pgTool('pg_ctl'), ['-D', directory, '-m', 'immediate', '-w', 'stop'], { stdio: 'inherit' });
        if (stopped.status !== 0) { console.error(`Could not stop test PostgreSQL; retained ${directory}`); process.exitCode = 1; }
        else await rm(directory, { recursive: true, force: true });
      } else await rm(directory, { recursive: true, force: true });
    }
    if (container) {
      const removed = spawnSync('docker', ['rm', '-f', container], { stdio: 'inherit' });
      if (removed.status !== 0) { console.error(`Could not remove test container ${container}`); process.exitCode = 1; }
    }
  }
}
