## API

Base URL: `https://stock-market-api.auenkr.com`

### List companies

`GET /api/list-of-company?page=1`

The optional `page` parameter is a positive integer. Each page contains up to 100 companies.

```bash
curl "https://stock-market-api.auenkr.com/api/list-of-company?page=1"
```

### List upcoming IPOs

`GET /api/list-of-ipo`

Returns the available upcoming IPO listings.

```bash
curl "https://stock-market-api.auenkr.com/api/list-of-ipo"
```

### Search companies

`GET /api/company-search?q=<company-name>`

The `q` parameter is required and can contain part of a company name.

```bash
curl "https://stock-market-api.auenkr.com/api/company-search?q=reli"
```

### Get company data

`GET /api/company-data?endpoint=<company-endpoint>`

The `endpoint` parameter is required. This request can take around 20 seconds.

```bash
curl "https://stock-market-api.auenkr.com/api/company-data?endpoint=/company/example"
```

Invalid query parameters return a JSON response with an `error` field and an appropriate HTTP status code.
