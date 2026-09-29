import Link from "next/link";

export default function DocsPage() {
  const responseExample = '{\n  "data": [...],\n  "meta": { "page": 1, "limit": 100 }\n}';
  const curlExample = 'curl https://stock-market-api.auenkr.com/v1/list-of-company\n  -H "X-API-Key: sm_live_your_key"';
  return (
    <div className="docs">
      <div className="section-head">
        <div><span className="eyebrow">Reference</span><h1>Documentation</h1></div>
        <Link className="button secondary" href="/dashboard">Dashboard</Link>
      </div>
      <p className="subtle">A small, focused API for Indian equity discovery and structured company data.</p>
      <h2>Authentication</h2>
      <p className="subtle">Create a key in the dashboard and send it with every versioned request.</p>
      <pre>{curlExample}</pre>
      <h2>Endpoints</h2>
      <table>
        <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td className="mono">GET</td><td className="mono">/v1/list-of-company?page=1</td><td>Paginated company directory</td></tr>
          <tr><td className="mono">GET</td><td className="mono">/v1/list-of-ipo</td><td>Upcoming IPO listings</td></tr>
          <tr><td className="mono">GET</td><td className="mono">/v1/company-search?q=reli</td><td>Search company names</td></tr>
          <tr><td className="mono">GET</td><td className="mono">/v1/company-data?endpoint=...</td><td>Structured company fundamentals</td></tr>
        </tbody>
      </table>
      <h2>Response envelope</h2>
      <pre>{responseExample}</pre>
      <p className="subtle">Full machine-readable contract: <a href="https://stock-market-api.auenkr.com/openapi.json">openapi.json ↗</a></p>
    </div>
  );
}
