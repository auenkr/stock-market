## Stock Market API

Base URL: `https://stock-market-api.auenkr.com`

The API provides structured Indian equity and IPO data for applications. The versioned API is available under `/v1`; the existing `/api` paths remain available for compatibility.

### Health and contract

`GET /health` returns service status. `GET /openapi.json` returns the machine-readable API contract.

Requests are limited to 60 requests per minute per client or API key. Dashboard-managed keys are stored in PostgreSQL and shown only once when created.

### List companies

`GET /v1/list-of-company?page=1`

The optional `page` parameter is a positive integer. Each page contains up to 100 companies.

```bash
curl "https://stock-market-api.auenkr.com/v1/list-of-company?page=1"
```

### List upcoming IPOs

`GET /v1/list-of-ipo`

Returns the available upcoming IPO listings.

```bash
curl "https://stock-market-api.auenkr.com/v1/list-of-ipo"
```

### Search companies

`GET /v1/company-search?q=<company-name>`

The `q` parameter is required and can contain part of a company name.

```bash
curl "https://stock-market-api.auenkr.com/v1/company-search?q=reli"
```

### Get company data

`GET /v1/company-data?endpoint=<company-endpoint>`

The `endpoint` parameter is required. This request can take around 20 seconds.

```bash
curl "https://stock-market-api.auenkr.com/v1/company-data?endpoint=/company/example"
```

Invalid query parameters return a JSON response with an `error` field and an appropriate HTTP status code.

## Developer Dashboard

The Next.js dashboard lives in `apps/web` and provides Better Auth sign-in, Drizzle-backed API-key management, and product documentation.

Start PostgreSQL and create the schema:

```bash
docker compose up -d postgres
DB_CONNECTION_URL="postgresql://stock_market:stock_market@localhost:5432/stock_market" pnpm db:push
```

Start the dashboard with the same single application setting:

```bash
DB_CONNECTION_URL="postgresql://stock_market:stock_market@localhost:5432/stock_market" pnpm dev:web
```

Open `http://localhost:3001`. API keys are shown only once at creation and stored as SHA-256 hashes.
