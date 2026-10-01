# Swagger and API docs maintenance

The canonical generated artifact is [../swagger.json](../swagger.json), OpenAPI 3.0.3, API version 1.2.0. It includes 53 non-history reference paths, personal aliases, legacy discovery routes, service routes, parameters, examples, response models, errors and coverage notes. There are 102 paths including aliases.

The API exposes the same contract at `/swagger.json` and `/openapi.json`, with its current request origin as the server. `/docs` on the Worker is a self-contained searchable contract viewer. The web `/docs` page imports the generated Swagger and offers endpoint/tier/coverage search, parameter forms, cURL copying, response status selection, schema browsing and explicit request execution. Unknown datasets display their 501 contract; they are not shown as successful integrations.

## Source of truth

- `apps/api/src/endpoint-catalog.ts`: paths, parameters, resource shapes and status.
- `apps/api/src/coverage-details.ts`: source-supported variations and missing fields, displayed in the explorer.
- `apps/api/src/reference-schemas.ts`: compatibility resource field schemas.
- `apps/api/src/legacy-schemas.ts`: original company, statement, directory and IPO types, including their response envelopes and units.
- `apps/api/src/openapi.ts`: OpenAPI generation, richer PL/BS/CF variants, action variants, error models and conventions.
- `apps/api/scripts/generate-swagger.ts`: writes root Swagger, the identical web download at `apps/web/public/swagger.json`, and `docs/endpoint-coverage.md`.

```bash
pnpm docs:generate
pnpm docs:check
pnpm test:api
pnpm typecheck
```

Update the source contract and adapter together, then regenerate. Do not manually edit generated JSON or the coverage matrix. `docs:check` detects stale artifacts. API tests verify reference path registration, schema references, unique operation IDs, and matching `/swagger.json`/`/openapi.json` responses.

## Server selection

Generated Swagger defaults to `http://localhost:8787`. Set `PUBLIC_URL` when generating for a different documented server. For the web request runner, `NEXT_PUBLIC_API_URL` overrides the default at build time; the server field can also be edited per session. Requests are made only when **Send request** is clicked. Optional API keys are kept in component memory, omitted from copied cURL examples, and not persisted by the docs UI. They remain development quota identifiers until validation is connected.

Response examples are synthetic schema illustrations, explicitly labeled, not live observations. The request runner displays actual HTTP status and response data from the selected server. Legacy operations declare `x-timeout-ms: 60000`; the runner uses this allowance for slow full-company/schedule requests instead of aborting them after 15 seconds. Each individual upstream request still has its own 15-second source timeout. The development web page and downloadable contract do not prove that a production API has been deployed.

## Recent API changes

`GET /api/company-data?symbol=RELIANCE` and its `/v1/company-data` alias accept one required symbol. They trim and uppercase the symbol and construct an encoded consolidated source path. The previous `endpoint` input no longer satisfies this route. `M&M` is sent as `symbol=M%26M`. The docs search includes aliases, and the company-data form has only the `symbol` input.

`/api/extract` and `/v1/extract` retain `endpoint` and `type`. The generated schemas document `{data, companyData}`, `{data, companies, page, limit, meta}`, `{data, ipos}`, `{data, results}` and extraction `{data, meta}`. Company-data and extraction share a 15-minute cache; `X-Cache: HIT` is present on a hit, and company-data also returns `Cache-Control: private, max-age=900`.

Swagger includes `X-Request-ID`, quota retry information and legacy 400/404/429/500/502 errors. Legacy values retain `{amount, baseValue}`; missing cells may become zero and absent source rows may be omitted. These differ from compatibility resources, which use rupees and null for missing financial values. Public legacy `metrics` remains empty; optional news/GMP failures preserve the main response.
