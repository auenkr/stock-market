import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import { Rate } from 'k6/metrics';

const base = (__ENV.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const mode = __ENV.SCENARIO || 'smoke';
const symbol = __ENV.SYMBOL || 'ACME';
const symbol2 = __ENV.SYMBOL_2 || 'DEMO';
const encoded = encodeURIComponent(symbol);
const encoded2 = encodeURIComponent(symbol2);
const outcomes = new Rate('expected_outcomes');
const throttled = new Rate('throttled_requests');
const profiles = {
  smoke: { executor: 'shared-iterations', vus: 1, iterations: 8, maxDuration: '1m', exec: 'journey' },
  load: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 5), timeUnit: '1s', duration: __ENV.DURATION || '2m', preAllocatedVUs: 10, maxVUs: 50, exec: 'journey' },
  stress: { executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s', preAllocatedVUs: 20, maxVUs: 100, stages: [{ target: 5, duration: '30s' }, { target: 20, duration: '1m' }, { target: 40, duration: '1m' }, { target: 0, duration: '30s' }], exec: 'journey' },
  spike: { executor: 'ramping-vus', startVUs: 1, stages: [{ target: 1, duration: '10s' }, { target: 50, duration: '5s' }, { target: 50, duration: '20s' }, { target: 1, duration: '5s' }], exec: 'journey' },
  soak: { executor: 'constant-vus', vus: Number(__ENV.VUS || 5), duration: __ENV.DURATION || '30m', exec: 'journey' },
  quota: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '1m', exec: 'quota' },
};
if (!profiles[mode]) throw new Error(`Unknown SCENARIO: ${mode}`);
export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: { [mode]: profiles[mode] },
  thresholds: {
    checks: ['rate==1'],
    expected_outcomes: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    // Local fixture budgets; override for an agreed deployment SLO.
    http_req_duration: [`p(95)<${__ENV.P95_MS || 1500}`, `p(99)<${__ENV.P99_MS || 3000}`],
    ...(mode === 'quota' ? {} : { dropped_iterations: ['count==0'] }),
  },
};
const params = (name, status = 200, key = __ENV.API_KEY) => ({
  headers: key ? { 'X-API-Key': key } : {}, tags: { name }, timeout: '30s', responseCallback: http.expectedStatuses(status),
});
function verify(response, status, contract) {
  throttled.add(response.status === 429);
  let body; try { body = response.json(); } catch { body = null; }
  const ok = check(response, {
    'expected status': r => r.status === status,
    'request ID returned': r => Boolean(r.headers['X-Request-Id']),
    'contract preserved': () => body !== null && contract(body, response),
  });
  outcomes.add(ok);
  if (!ok) console.error(`Response check failed: ${response.url} status=${response.status}`);
  return body;
}
export function setup() {
  if (!__ENV.API_KEY) fail('API_KEY is required (the local runner provisions one)');
  const health = http.get(`${base}/health`, params('setup_health', 200, ''));
  if (health.status !== 200) fail('Target health check failed');
  if (mode === 'quota') {
    if (!__ENV.QUOTA_KEY || !__ENV.QUOTA_KEY_2) fail('quota requires two unused keys belonging to one account with a 10/min limit');
  } else {
    // Prewarm only the explicitly warm scenario. Cold requests use fresh symbols.
    const response = http.get(`${base}/v1/company-profile/${encoded}`, params('setup_warm_profile'));
    if (response.status !== 200) fail('Authenticated source readiness failed');
  }
  return { started: Date.now() };
}
export function journey() {
  const routes = [
    [`/v1/company-profile/${encoded}`, 'warm_profile', 200, b => typeof b === 'object' && !b.error],
    [`/v1/financials/${encoded}?statement_type=s&statement_code=pl&period=annual`, 'financials', 200, b => Array.isArray(b.financials) && b.financials.length > 0],
    [`/api/v2/quote?symbol=${encoded}&symbol=${encoded2}`, 'batch_quotes', 200, b => Boolean(b[symbol] && b[symbol2])],
    [`/enterprise/api/company-profile?symbols=${encoded},${encoded2}`, 'enterprise_profiles', 200, b => Array.isArray(b) && b.length === 2],
    ['/v1/list-of-company?page=1', 'legacy_pagination', 200, b => Array.isArray(b.data) && b.meta.limit === 100],
    [`/v1/company-search?q=${encoded}`, 'legacy_search', 200, b => Array.isArray(b.data) && Array.isArray(b.results) && b.data.length === b.results.length && b.data.every((row, i) => row.name === b.results[i].name && row.url === b.results[i].url)],
    [`/v1/financials/${encoded}`, 'validation', 400, b => typeof b.error === 'string'],
    ['/v1/quote', 'unavailable', 501, b => b.code === 'DATASET_UNAVAILABLE'],
  ];
  const [path, name, status, contract] = routes[exec.scenario.iterationInTest % routes.length];
  verify(http.get(base + path, params(name, status)), status, contract);
  verify(http.get(`${base}/v1/coverage`, params('invalid_key', 401, 'invalid')), 401, b => typeof b.error === 'string');
  verify(http.get(`${base}/health`, params('health', 200, '')), 200, b => b.status === 'ok');
  if (__ENV.COLD_SOURCE === '1') {
    // Only fixture servers can answer these synthetic symbols. Each misses the source cache.
    const symbol = `COLD${exec.vu.idInTest}_${exec.scenario.iterationInTest}`;
    verify(http.get(`${base}/v1/company-profile/${symbol}`, params('cold_profile')), 200, b => typeof b === 'object' && !b.error);
  }
  sleep(Number(__ENV.THINK_TIME || 0.1));
}
export function quota() {
  const requests = Array.from({ length: 14 }, (_, i) => ['GET', `${base}/v1/coverage`, null, {
    ...params('shared_quota', 200, i % 2 ? __ENV.QUOTA_KEY : __ENV.QUOTA_KEY_2), responseCallback: http.expectedStatuses(200, 429),
  }]);
  const responses = http.batch(requests);
  const allowed = responses.filter(r => r.status === 200).length;
  const limited = responses.filter(r => r.status === 429).length;
  const ok = check(responses, { 'exactly 10 accepted and 4 limited': () => allowed === 10 && limited === 4 });
  outcomes.add(ok);
  for (const response of responses) {
    verify(response, response.status === 429 ? 429 : 200, (b, r) => r.status === 200 ? Array.isArray(b.endpoints) : b.code === 'RATE_LIMIT_EXCEEDED' && Number(r.headers['Retry-After']) > 0 && r.headers['Cache-Control'] === 'no-store');
  }
  verify(http.get(`${base}/health`, params('health_after_quota', 200, '')), 200, b => b.status === 'ok');
}
export function teardown() {
  // Database, keys and HTTP servers are owned and removed by the Node runner.
  const response = http.get(`${base}/health`, params('teardown_health', 200, ''));
  check(response, { 'service healthy after workload': r => r.status === 200 });
}
export function handleSummary(data) {
  return { [__ENV.SUMMARY_PATH || 'k6-summary.json']: JSON.stringify(data, null, 2), stdout: `k6 ${mode} complete; thresholds ${Object.values(data.metrics).every(m => !m.thresholds || Object.values(m.thresholds).every(t => t.ok)) ? 'passed' : 'FAILED'}\n` };
}
