//! Free public stock market data server with optional Valkey caching.

mod cache;
mod catalog;
mod company;
mod config;
mod error;
mod ipo;
mod legacy;
mod parse;
mod provider;
mod routes;
mod session;
mod source;

use std::time::Duration;

#[tokio::main]
async fn main() {
    // Offline contract export: no .env, credentials, cache, or listener needed.
    if std::env::args().any(|arg| arg == "--export-openapi") {
        println!("{}", catalog::openapi_spec("https://stock-market-api.auenkr.com", "production"));
        return;
    }
    tracing_subscriber::fmt().json().init();
    let config = config::Config::from_env();

    let cache = if config.cache_enabled() {
        match tokio::time::timeout(
            Duration::from_secs(12),
            cache::SourceCache::new(config.valkey_url.as_deref(), config.valkey_prefix.clone()),
        )
        .await
        {
            Ok(cache) => Some(cache),
            Err(_) => {
                tracing::warn!(
                    event = "api.cache.startup_timeout",
                    "Valkey connection timed out; starting without cache"
                );
                None
            }
        }
    } else {
        None
    };
    let ipo = ipo::Ipo::new(config.ipo_base_url.clone(), cache.clone());
    let source = source::Source::new(
        config.source_base_url.clone(),
        config.source_credentials(),
        cache,
        config.source_pacing_ms,
    );
    let state = routes::AppState {
        config: config.clone(),
        provider: provider::Provider::new(source),
        ipo,
    };

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
