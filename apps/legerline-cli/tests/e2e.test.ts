import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from '../../api/tests/harness.js';
import { db } from '@stock-market/db';

let fixture: Awaited<ReturnType<typeof setup>>;
let configHome: string;
before(async () => {
  fixture = await setup();
  configHome = await mkdtemp(join(tmpdir(), 'legerline-config-'));
});
after(async () => {
  try { await fixture?.cleanup(); await rm(configHome, { recursive: true, force: true }); } finally { await db.$client.end({ timeout: 1 }); }
});

type Result = { code: number | null; stdout: string; stderr: string };

function cli(args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--import', 'tsx', 'apps/legerline-cli/src/index.ts', ...args], {
      cwd: new URL('../../../', import.meta.url).pathname,
      env: { ...process.env, XDG_CONFIG_HOME: configHome, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout, stderr }));
    child.stdin.write(opts.input ?? '');
    child.stdin.end();
  });
}

const baseEnv = () => ({ LEGERLINE_API_URL: fixture.urls[0]!, LEGERLINE_API_KEY: fixture.secret });

test('set-api-key saves config, config reports masked state', async () => {
  const set = await cli(['set-api-key', fixture.secret], { env: { LEGERLINE_API_URL: fixture.urls[0]!, LEGERLINE_API_KEY: '' } });
  assert.equal(set.code, 0, set.stderr);
  const saved = JSON.parse(await readFile(join(configHome, 'legerline', 'config.json'), 'utf8'));
  assert.equal(saved.apiKey, fixture.secret);
  const shown = await cli(['config'], { env: { LEGERLINE_API_URL: fixture.urls[0]!, LEGERLINE_API_KEY: '' } });
  assert.equal(shown.code, 0);
  const parsed = JSON.parse(shown.stdout);
  assert.equal(parsed.apiKey, 'set');
  assert.equal(parsed.apiUrl, fixture.urls[0]);
});

test('prompts for key when missing and saves it', async () => {
  await rm(join(configHome, 'legerline'), { recursive: true, force: true });
  const res = await cli(['get_v1_company_search', '--q', 'acme'], { env: { LEGERLINE_API_URL: fixture.urls[0]!, LEGERLINE_API_KEY: '' }, input: fixture.secret + '\n' });
  // stdin is not a TTY, so the CLI must fail closed with a helpful message instead of hanging
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Missing API key/);
});

test('search and company commands return API JSON', async () => {
  await writeFileSafe(configHome, fixture.secret, fixture.urls[0]!);
  const search = await cli(['get_v1_company_search', '--q', 'acme'], { env: { LEGERLINE_API_KEY: '' } });
  assert.equal(search.code, 0, search.stderr);
  const results = JSON.parse(search.stdout);
  assert.equal(results.results[0].symbol, '/company/ACME/');

  const profile = await cli(['get_api_v1_company_profile', '--symbol', '/company/ACME/'], { env: { LEGERLINE_API_KEY: '' } });
  assert.equal(profile.code, 0, profile.stderr);
  const profileJson = JSON.parse(profile.stdout);
  assert.equal(profileJson.symbol, '/company/ACME/');
});

async function writeFileSafe(home: string, key: string, url: string) {
  const dir = join(home, 'legerline');
  await import('node:fs/promises').then(fs => fs.mkdir(dir, { recursive: true }));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ apiKey: key, apiUrl: url }));
}

test('errors are short and non-zero', async () => {
  const badKey = await cli(['get_v1_company_search', '--q', 'acme'], { env: { LEGERLINE_API_URL: fixture.urls[0]!, LEGERLINE_API_KEY: 'sm_live_wrong' } });
  assert.equal(badKey.code, 1);
  assert.match(badKey.stderr, /^Error: Invalid or expired API key\./);

  const noSymbol = await cli(['get_api_v1_company_profile'], { env: baseEnv() });
  assert.equal(noSymbol.code, 1);
  assert.match(noSymbol.stderr, /Missing --symbol/);

  const unknown = await cli(['nope'], { env: baseEnv() });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown command/);

  const unreachable = await cli(['get_v1_company_search', '--q', 'acme'], { env: { ...baseEnv(), LEGERLINE_API_URL: 'http://127.0.0.1:1' } });
  assert.equal(unreachable.code, 1);
  assert.match(unreachable.stderr, /Cannot reach API/);
});

test('help lists public commands and no internal endpoints', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /set-api-key/);
  assert.match(help.stdout, /get_api_v1_shareholding_pattern/);
  assert.doesNotMatch(help.stdout, /get_v1_company_data|get_v1_extract|ownership|corporate-actions|get_health|get_coverage/);
});
