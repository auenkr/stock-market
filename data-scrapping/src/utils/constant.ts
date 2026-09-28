import { join } from "path";
import dotenv from "dotenv";

dotenv.config();

// Config for getting data

export const BASE_URL =
  process.env.BASE_URL ||
  "Enter Base URL here, eg: https://www.my-website-testing.com";
export const COOKIE = process.env.COOKIE || "Enter Cookie here";

// Directory for output files
export const outputDir = join(__dirname, "./../../gen");

export const companyListFile = outputDir + "/company-list.json";
export const upcomingIpoFile = join(outputDir, "upcoming-ipo.json");
export const TotalCompanies = 5176;

// All Company Data File
export const allCompanyDataDir = join(outputDir + "/companyData/");

// All EV and EBITA Valuation Result File
export const allEVAndEBITAValuationResultFile = join(outputDir + "/evAndEBITAValuationResult.csv");

export const allEVAndEBITAValuationResultFailedFile = join(outputDir + "/evAndEBITAValuationResultFailed.json");

// Rate Limit values

export const DELAY_BETWEEN_API_REQUEST = 1200;
export const DELAY_BETWEEN_COMPANY_DATA_REQUEST = 3000;
export const DELAY_BETWEEN_ERROR_REQUEST = 6000;

export const PORT = process.env.PORT ?? 3000;

const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

export const COMPANY_PAGE_SIZE = 100;

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
        <p>The optional <code>page</code> parameter is a positive integer. Each page contains up to 100 companies.</p>
        <pre><code>curl "${PUBLIC_URL}/api/list-of-company?page=1"</code></pre>

        <h2>List upcoming IPOs</h2>
        <p><code>GET /api/list-of-ipo</code></p>
        <p>Returns the available upcoming IPO listings.</p>
        <pre><code>curl "${PUBLIC_URL}/api/list-of-ipo"</code></pre>

        <h2>Get company data</h2>
        <p><code>GET /api/company-data?endpoint=&lt;company-endpoint&gt;</code></p>
        <p>The <code>endpoint</code> parameter is required. This request can take around 20 seconds.</p>
        <pre><code>curl "${PUBLIC_URL}/api/company-data?endpoint=/company/example"</code></pre>

        <h2>Search companies</h2>
        <p><code>GET /api/company-search?q=&lt;company-name&gt;</code></p>
        <p>The <code>q</code> parameter is required and can contain part of a company name.</p>
        <pre><code>curl "${PUBLIC_URL}/api/company-search?q=reli"</code></pre>

        <h2>Errors</h2>
        <p>Invalid query parameters return a JSON response with an <code>error</code> field and an appropriate HTTP status code.</p>
      </body>
    </html>
`
