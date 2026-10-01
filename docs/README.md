# API development records

This directory records endpoint coverage, source limitations, implementation progress, and the remaining work for the API SaaS described in [GOAL.md](../GOAL.md).

- [Endpoint coverage](endpoint-coverage.md): personal and enterprise routes, available sources, and exclusions.
- [API compatibility](api-compatibility.md): requests, response shapes, units, pagination, and errors.
- [Limitations](limitations.md): missing datasets and SaaS infrastructure requirements.
- [Progress](progress.md): completed work and validation evidence.
- [Screener exploration](screener-exploration.md): browser findings, source paths and remaining access/data gaps.
- [Swagger maintenance](swagger.md): contract generation, docs explorer and drift checks.

Update these records when a route, source, response mapping, or deployment capability changes. A route returning `501 DATASET_UNAVAILABLE` is a documented gap, not a completed data integration.
