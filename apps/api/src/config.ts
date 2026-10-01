export const COMPANY_PAGE_SIZE = 100;
const PUBLIC_URL =
  (typeof process === "undefined" ? undefined : process.env.PUBLIC_URL) ||
  "http://localhost:8787";

export const HomePageData = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Stock Market API</title>
        <style>
          :root { color-scheme: dark; --bg: #0b1020; --panel: #121a2e; --text: #e8eefc; --muted: #9aa8c7; --accent: #72e0b8; }
          body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; }
          main { margin: 0 auto; max-width: 58rem; padding: 5rem 1.5rem; }
          h1 { font-size: clamp(2.5rem, 7vw, 5rem); line-height: .95; letter-spacing: -.06em; max-width: 11ch; }
          h2 { margin-top: 3rem; }
          p { color: var(--muted); max-width: 46rem; }
          code, pre { background: var(--panel); border: 1px solid #253152; border-radius: .5rem; }
          code { padding: .15rem .35rem; color: var(--accent); }
          pre { overflow-x: auto; padding: 1rem; color: var(--accent); }
          a { color: var(--accent); }
        </style>
      </head>
      <body><main>
        <p>MARKET DATA / API v1</p><h1>Build on better market data.</h1>
        <p>Independent Indian company fundamentals, ownership, corporate actions and IPO data. Explore <a href="/docs">the API reference</a>, download <a href="/swagger.json">swagger.json</a>, or check <a href="/v1/coverage">current coverage</a>. Source-backed adapters have partial coverage; market history is excluded.</p>
        <h2>Company fundamentals</h2>
        <pre><code>curl "${PUBLIC_URL}/v1/financials/ITC?statement_type=c&amp;statement_code=pl&amp;period=annual"</code></pre>
        <h2>Dividends and ownership</h2>
        <p><code>GET /v1/dividend/ITC</code> · <code>GET /v1/shareholdings/ownership-current/ITC</code></p>
        <h2>List companies</h2>
        <p><code>GET /api/list-of-company?page=1</code></p>
        <pre><code>curl "${PUBLIC_URL}/v1/list-of-company?page=1"</code></pre>
        <h2>List upcoming IPOs</h2>
        <p><code>GET /api/list-of-ipo</code></p>
        <pre><code>curl "${PUBLIC_URL}/v1/list-of-ipo"</code></pre>
        <h2>Get company data</h2>
        <p><code>GET /api/company-data?symbol=&lt;stock-symbol&gt;</code></p>
        <pre><code>curl "${PUBLIC_URL}/v1/company-data?symbol=RELIANCE"</code></pre>
        <h2>Search companies</h2>
        <p><code>GET /api/company-search?q=&lt;company-name&gt;</code></p>
        <pre><code>curl "${PUBLIC_URL}/v1/company-search?q=reli"</code></pre>
      </main></body>
    </html>
`;
