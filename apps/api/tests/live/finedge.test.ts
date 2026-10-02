import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FinEdgeProvider } from '../../src/finedge-provider.js';
import { createCompatibilityApi } from '../../src/compatibility-api.js';

// Explicit opt-in: consumes subscription calls; no token or upstream URL is printed.
test('live FinEdge Basic datasets and financial variants', { skip: !process.env.FINEDGE_API_KEY }, async () => {
  const provider = new FinEdgeProvider({ apiKey: process.env.FINEDGE_API_KEY! });
  const app = createCompatibilityApi(() => provider);
  const paths = [
    '/v1/name-changes?from_date=2026-01-01&to_date=2026-10-01',
    '/v1/symbol-changes?from_date=2026-01-01&to_date=2026-10-01',
    '/v1/segment-revenue/ITC?statement_type=c&statement_code=pl&period=annual',
    '/v1/notes/ITC?statement_type=c&period=annual',
    '/v1/shareholdings/declaration/ITC?period=quarterly',
    '/v1/shareholdings/beneficial-owners/ITC?period=quarterly',
    '/v1/index/master', '/v1/index/market-price/daily-feed', '/v1/index/price-returns', '/v1/holidays-calendar',
    '/v1/financials/ITC?statement_type=c&statement_code=bs&period=quarterly',
    '/v1/ratios/ITC?statement_type=c&ratio_type=li',
    '/v1/financial-metrics/ITC?statement_type=c&ratio_type=gr',
    '/v1/basic-financials/ITC?statement_type=c&statement_code=bs',
  ];
  for (const path of paths) {
    const response = await app.request(path); assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-data-source'), 'finedge');
    const body = await response.json() as any;
    if (path.includes('/notes/')) assert(Array.isArray(body.notes));
    if (path.includes('/declaration/')) assert(Array.isArray(body.declarations));
    if (path.includes('/basic-financials/')) assert(Array.isArray(body.basic_financials));
    if (path.includes('/segment-revenue/')) assert(body.segment_revenues.some((row: any) => row.segments.some((segment: any) => segment.data.segmentRevenue > 0)));
    if (path.includes('/financials/')) assert(body.financials.some((row: any) => row.currentAssets > 10000000));
    if (path.includes('/ratios/')) assert(body.ratios.some((row: any) => typeof row.currentRatio === 'number'));
    if (path.includes('/financial-metrics/')) assert.equal(typeof body.financial_metrics.assetGrowth3years, 'number');
  }
  const denied = await app.request('/v1/segment-revenue/TCS?statement_type=c&statement_code=pl&period=annual');
  assert.equal(denied.status, 501); assert.equal((await denied.json() as any).code, 'SOURCE_PLAN_RESTRICTED');
});
