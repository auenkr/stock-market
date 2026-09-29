export const COMPANY_PAGE_SIZE = 100;
const PUBLIC_URL =
  (typeof process === "undefined" ? undefined : process.env.PUBLIC_URL) ||
  "http://localhost:3000";

export const HomePageData = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Stock Market API</title>
        <style>
          body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 2rem auto; max-width: 50rem; padding: 0 1rem; }
          code, pre { background: #f1f5f9; border-radius: 0.25rem; }
          code { padding: 0.15rem 0.3rem; }
          pre { overflow-x: auto; padding: 1rem; }
        </style>
      </head>
      <body>
        <h1>Stock Market API</h1>
        <p>Use these endpoints to retrieve company and upcoming IPO listings, search companies, and scraped company data.</p>
        <h2>List companies</h2>
        <p><code>GET /api/list-of-company?page=1</code></p>
        <pre><code>curl "${PUBLIC_URL}/api/list-of-company?page=1"</code></pre>
        <h2>List upcoming IPOs</h2>
        <p><code>GET /api/list-of-ipo</code></p>
        <pre><code>curl "${PUBLIC_URL}/api/list-of-ipo"</code></pre>
        <h2>Get company data</h2>
        <p><code>GET /api/company-data?endpoint=&lt;company-endpoint&gt;</code></p>
        <pre><code>curl "${PUBLIC_URL}/api/company-data?endpoint=/company/example"</code></pre>
        <h2>Search companies</h2>
        <p><code>GET /api/company-search?q=&lt;company-name&gt;</code></p>
        <pre><code>curl "${PUBLIC_URL}/api/company-search?q=reli"</code></pre>
      </body>
    </html>
`;
