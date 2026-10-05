//! Stock Market API (Rust). Same HTTP contract as the TypeScript Worker, tuned
//! for minimal latency in a container: warm Postgres pool, multiplexed Valkey
//! connection, keep-alive upstream client and in-process request coalescing.

mod auth;
mod cache;
mod catalog;
mod company;
mod config;
mod error;
mod legacy;
mod parse;
mod provider;
mod routes;
mod source;

use deadpool_postgres::{Config as PgConfig, Runtime};
use std::time::Duration;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();
    let config = config::Config::from_env();

    let db = if config.database_url.trim().is_empty() {
        tracing::warn!(event = "api.db.disabled", "DATABASE_URL is empty; authorization will fail closed");
        None
    } else {
        let mut pg = PgConfig::new();
        pg.url = Some(config.database_url.clone());
        pg.pool = Some(deadpool_postgres::PoolConfig::new(config.db_pool_max));
        let tls = tokio_postgres_rustls::MakeRustlsConnect::with_webpki_roots();
        match pg.create_pool(Some(Runtime::Tokio1), tls) {
            Ok(pool) => {
                // Warm asynchronously: an unreachable remote database must not
                // prevent the HTTP listener (including /health) from starting.
                let warm_pool = pool.clone();
                tokio::spawn(async move {
                    if let Ok(Ok(client)) = tokio::time::timeout(Duration::from_secs(3), warm_pool.get()).await {
                        let _ = tokio::time::timeout(Duration::from_secs(2), client.query_opt("SELECT 1", &[])).await;
                    }
                });
                Some(pool)
            }
            Err(e) => {
                tracing::warn!(event = "api.db.unavailable", error = %e, "continuing without database; authorization will fail closed");
                None
            }
        }
    };

    let cache = if config.cache_enabled() {
        match tokio::time::timeout(
            Duration::from_secs(12),
            cache::SourceCache::new(config.valkey_url.as_deref(), config.valkey_prefix.clone()),
        )
        .await
        {
            Ok(cache) => Some(cache),
            Err(_) => {
                tracing::warn!(event = "api.cache.startup_timeout", "Valkey connection timed out; starting without cache");
                None
            }
        }
    } else {
        None
    };
    let source = source::Source::new(
        config.source_base_url.clone(),
        config.source_cookie.clone(),
        cache,
        config.source_pacing_ms,
    );
    let state = routes::AppState { config: config.clone(), db, provider: provider::Provider::new(source) };

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!(event = "api.started", port = config.port, environment = %config.environment);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, routes::router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
}
