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
use tokio_postgres::NoTls;

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
        match pg.create_pool(Some(Runtime::Tokio1), NoTls) {
            Ok(pool) => {
                // Warm one connection so the first authorization pays no setup cost.
                if let Ok(client) = pool.get().await {
                    let _ = client.query_opt("SELECT 1", &[]).await;
                }
                Some(pool)
            }
            Err(e) => {
                tracing::warn!(event = "api.db.unavailable", error = %e, "continuing without database; authorization will fail closed");
                None
            }
        }
    };

    let cache = if config.cache_enabled() {
        Some(cache::SourceCache::new(config.valkey_url.as_deref(), config.valkey_prefix.clone()).await)
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
