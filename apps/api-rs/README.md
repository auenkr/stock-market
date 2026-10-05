# Stock Market API (Rust)

A from-scratch Rust port of `@stock-market/api` with an identical HTTP contract,
tuned for minimal latency in a container.

## Contract guarantee

`apps/api/tests/contract/` is a black-box suite that runs purely over HTTP, so
the same file verifies the TypeScript service and this rewrite:

- `pnpm --filter @stock-market/api test:contract` — self-contained run against
  the TypeScript service (disposable Postgres + Valkey + fixture source).
- `apps/api/tests/contract/fixture-server.mjs` — deterministic upstream source.
- `CONTRACT_BASE_URL=... CONTRACT_DATABASE_URL=... CONTRACT_FIXTURE_SOURCE=1
  pnpm --filter @stock-market/api test:contract:external` — same suite against
  a running server (this service).
- `pnpm test:contract:rust` — builds and starts this Rust service and a fixture
  upstream, then runs the shared HTTP suite against a migrated disposable
  database. Set `CONTRACT_DATABASE_URL` and optionally `VALKEY_URL` first; CI
  provisions both services automatically.

## Latency design

- **Direct Postgres pool** (`DATABASE_URL`). Hyperdrive is a Workers-only
  accelerator, so the container uses a small warm pool (`DB_POOL_MAX`, default
  5) with prepared statements. Auth is one lookup + one atomic quota upsert —
  the same two round trips as the TypeScript adapter.
- **Valkey read-through cache** (`VALKEY_URL`, `VALKEY_CACHE_PREFIX`) with the
  same key derivation, TTLs and JSON envelope as the TypeScript adapter, so both
  implementations share entries. In-process singleflight coalesces concurrent
  misses; a distributed lock coalesces across instances.
- **One reqwest client** with keep-alive and gzip for all upstream fetches.
- No ORM, no regex engine on hot paths, insertion-ordered maps so response
  bytes match the TypeScript adapter exactly.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `ENVIRONMENT` | `production` | `dev` exposes internal docs routes |
| `DATABASE_URL` | — | Direct Postgres connection string (empty fails auth closed) |
| `DB_POOL_MAX` | `5` | Postgres pool size |
| `VALKEY_URL` | — | Valkey/Redis URL (empty disables caching) |
| `VALKEY_CACHE_PREFIX` | `stock-market:{ENVIRONMENT}` | Cache namespace |
| `SOURCE_BASE_URL` | `https://www.screener.in` | Upstream source (point at `fixture-server.mjs` for verification) |
| `SOURCE_COOKIE` | — | Upstream session cookie |
| `SOURCE_PACING_MS` | `1200` | Delay after uncached upstream detail fetches (`0` for tests) |

## Run locally

```sh
cargo run -- --help # no CLI flags; configuration is env-only
DATABASE_URL=postgresql://... VALKEY_URL=redis://... cargo run
```

## Docker

The multi-platform image statically links the Rust executable against musl and
uses `scratch` at runtime. The runtime filesystem contains the API executable
and CA certificate data only; it does not require glibc, QEMU, or another
runtime executable.

```sh
docker build -t stock-market-api-rs ./apps/api-rs
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e VALKEY_URL=redis://... \
  -e VALKEY_CACHE_PREFIX=stock-market:production \
  -e ENVIRONMENT=production \
  stock-market-api-rs
```
