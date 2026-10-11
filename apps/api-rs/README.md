# Rust data server

Free public GET endpoints, without credentials or an account database. Run `cargo run` with `ENVIRONMENT=dev PORT=8787`. Optional Valkey caching and upstream source configuration are listed in [sample.env](../../sample.env). `/health`, `/docs`, `/openapi.json`, and `/v1/coverage` describe the server. Build the container from this directory. Deployment uses the existing Cloudflare Tunnel to the container host.
