# API development records

This directory records endpoint coverage, source limitations, implementation progress, and the remaining work for the API SaaS described in [GOAL.md](../GOAL.md).

- [Endpoint user journey](endpoint-journey.md): Search, Company overview, Finance, and Internal categories and endpoint order.
- [Endpoint coverage](endpoint-coverage.md): personal routes grouped by use case, available sources, and exclusions.
- [API compatibility](api-compatibility.md): requests, response shapes, units, pagination, and errors.
- [Limitations](limitations.md): missing datasets and SaaS infrastructure requirements.
- [Progress](progress.md): completed work and validation evidence.
- [Screener exploration](screener-exploration.md): browser findings, source paths and remaining access/data gaps.
- [Swagger maintenance](swagger.md): contract generation, docs explorer and drift checks.
- [Polar setup](polar-setup.md): monthly subscriptions, legal consent, deployment migration, and Polar account configuration.
- [Production deployment](deployment.md): GitHub Actions deployments from `main`, provider configuration, and required secrets.
- [ChatGPT plugin](plugin.md): agent manifest/OpenAPI, shared tool contract, competitor research, and the pricing decision.

Update these records when a route, source, response mapping, or deployment capability changes. A route returning `501 DATASET_UNAVAILABLE` is a documented gap, not a completed data integration.
