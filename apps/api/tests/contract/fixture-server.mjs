// Standalone deterministic upstream source for contract verification.
// Mirrors the fixture behaviour in apps/api/tests/harness.ts without any
// dependencies: `node fixture-server.mjs [port]` prints the base URL.
// Point the server under test at it (SOURCE_BASE_URL / BASE_URL) and run the
// suite with CONTRACT_FIXTURE_SOURCE=1.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturePath = process.env.FIXTURE_HTML ?? join(root, 'src', 'fixtures', 'company.html');
const fixture = readFileSync(fixturePath, 'utf8');
const stripped = fixture.replace(/<section id="(?:profit-loss|quarters|balance-sheet|cash-flow|ratios|quarterly-shp)">[\s\S]*?<\/section>/g, '');

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  process.stderr.write(`fixture ${url.pathname}${url.search}\n`);
  res.setHeader('Content-Type', 'text/html');
  if (url.pathname.includes('/MISSING/')) { res.writeHead(404); res.end('Missing'); return; }
  if (url.pathname.includes('/FAIL/')) { res.writeHead(503); res.end('Unavailable'); return; }
  if (url.pathname.includes('/LOGIN/')) { res.end('<title>Login</title><form action="/login/">'); return; }
  if (url.pathname === '/api/company/search/') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ name: 'Acme Ltd', url: '/company/ACME/' }])); return; }
  if (url.pathname.endsWith('/screen/raw/')) { res.end('<table class="data-table"><thead><tr><th>Company</th><th>Market Capitalization</th></tr></thead><tbody><tr><td><a href="/company/ACME/">Acme Ltd</a></td><td>1,234.5</td></tr></tbody></table>'); return; }
  if (url.pathname.endsWith('/peers')) { res.end(`<table class="data-table"><tbody><tr><td>1</td><td><a href="/company/DEMO/">Demo Ltd</a></td>${'<td>10</td>'.repeat(9)}</tr></tbody></table>`); return; }
  if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return; }
  if (url.pathname.startsWith('/screens/') || url.pathname.startsWith('/market/IN')) {
    res.end(`<table class="data-table"><tbody><tr><td>1</td><td><a href="/company/ACME/">Acme Ltd</a></td>${'<td>10</td>'.repeat(9)}</tr></tbody></table>${url.searchParams.get('page') === '2' ? '' : '<div class="pagination"><a href="?page=2">Next</a></div>'}`); return;
  }
  if (url.pathname.startsWith('/ipo')) { res.end('<table class="data-table"><tbody></tbody></table>'); return; }
  if (url.pathname.startsWith('/actions/') || url.pathname.startsWith('/upcoming-results/')) { res.end('<table id="result_list"><tbody></tbody></table>'); return; }
  if (url.pathname.startsWith('/company/actions/')) { res.end('<section id="corporate-actions-bonus"><table><tbody></tbody></table></section>'); return; }
  res.end((url.pathname.includes('/LEGACY/') || url.pathname.startsWith('/company/id/') || url.pathname.includes('/GVT&D/')) ? stripped : fixture);
});

const port = Number(process.argv[2] ?? process.env.PORT ?? 0);
server.listen(port, '127.0.0.1', () => {
  console.log(`FIXTURE_SOURCE_URL=http://127.0.0.1:${server.address().port}`);
});
