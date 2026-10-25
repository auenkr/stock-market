# Client sync and releases

Run `pnpm sync:clients` after changing the Rust public API. This exports OpenAPI
directly from local Rust source without loading environment variables or starting
the server, regenerates the CLI catalog, and verifies MCP routes, parameters,
and required flags against the same public contract. Internal endpoints are
excluded. Commit the generated catalog alongside API changes.

`pnpm sync:clients:check` fails on contract drift and runs before publishing.

Every push to `main` runs `.github/workflows/publish.yml`:

1. Check client sync, typecheck, run tests, and build.
2. Publish `auenkr/stock-market-api-rs:main-latest` and a commit-SHA tag for
   `linux/amd64` and `linux/arm64`.
3. Publish both npm packages with unique versions
   `<package-version>-main.<run-number>.<attempt>` under the `latest` dist-tag.
   This publishes each push without committing automatic version bumps or
   attempting to overwrite immutable npm versions.

Repository secrets: `DOCKERHUB_TOKEN` and `NPM_TOKEN` (publish access to both
packages). CI does not deploy the API container or the hosted Cloudflare MCP.
The owner updates those deployments separately.
