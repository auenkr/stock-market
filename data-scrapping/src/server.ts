import { Hono } from "hono";
import { GetCompanyData } from "./helper/getCompanyData";
import { getCompanyList } from "./helper/getCompanyList";
import { sendReq } from "./utils/sendReq";

const COMPANY_PAGE_SIZE = 100;

const PORT = process.env.PORT ?? 3000;

const app = new Hono();
const companyDataCache = new Map<string, Awaited<ReturnType<typeof GetCompanyData>>>();

app.get("/", (c) => {
  return c.html(`
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
        <p>Use these endpoints to retrieve company listings and scraped company data.</p>

        <h2>List companies</h2>
        <p><code>GET /api/list-of-company?page=1</code></p>
        <p>The optional <code>page</code> parameter is a positive integer. Each page contains up to 100 companies.</p>
        <pre><code>curl "http://localhost:${PORT}/api/list-of-company?page=1"</code></pre>

        <h2>Get company data</h2>
        <p><code>GET /api/company-data?endpoint=&lt;company-endpoint&gt;</code></p>
        <p>The <code>endpoint</code> parameter is required. This request can take around 20 seconds.</p>
        <pre><code>curl "http://localhost:${PORT}/api/company-data?endpoint=/company/example"</code></pre>

        <h2>Errors</h2>
        <p>Invalid query parameters return a JSON response with an <code>error</code> field and an appropriate HTTP status code.</p>
      </body>
    </html>
  `);
});

app.get("/api/list-of-company", async (c) => {
  const pageParam = c.req.query("page") ?? "1";
  const page = Number(pageParam);

  if (!Number.isInteger(page) || page < 1) {
    return c.json({ error: "page must be a positive integer" }, 400);
  }

  const companies = await getCompanyList(COMPANY_PAGE_SIZE, page);

  return c.json({
    page,
    limit: COMPANY_PAGE_SIZE,
    companies,
  });
});

// This takes around 20 sec to run
app.get("/api/company-data", async (c) => {
  try {
    const endpoint = c.req.query("endpoint") || "";
    if (endpoint === "") {
      return c.json({ error: "endpoint parameter is required" }, 400);
    }

    const cachedCompanyData = companyDataCache.get(endpoint);
    if (cachedCompanyData) {
      return c.json({ companyData: cachedCompanyData });
    }

    const companyData = await GetCompanyData(endpoint);
    companyDataCache.set(endpoint, companyData);

    return c.json({ companyData });
  } catch (error) {
    return c.json({ error: "Could not scrape company data" }, 500);
  }
});

export default app;
