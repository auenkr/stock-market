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
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, Error as TlsError, SignatureScheme,
};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug)]
struct InsecureServerCertVerifier;

impl ServerCertVerifier for InsecureServerCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::ED25519,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
}

fn postgres_tls(
    ca_cert_file: Option<&str>,
    verify_cert: bool,
) -> Result<tokio_postgres_rustls::MakeRustlsConnect, Box<dyn std::error::Error>> {
    if !verify_cert {
        return Ok(tokio_postgres_rustls::MakeRustlsConnect::new(
            rustls::ClientConfig::builder()
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(InsecureServerCertVerifier))
                .with_no_client_auth(),
        ));
    }

    let Some(path) = ca_cert_file else {
        return Ok(tokio_postgres_rustls::MakeRustlsConnect::with_webpki_roots());
    };

    let file = std::fs::File::open(path)?;
    let certs =
        rustls_pemfile::certs(&mut std::io::BufReader::new(file)).collect::<Result<Vec<_>, _>>()?;
    if certs.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "DATABASE_CA_CERT_FILE contains no PEM certificates",
        )
        .into());
    }

    let mut roots =
        rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    for cert in certs {
        roots.add(cert)?;
    }
    let tls = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(tokio_postgres_rustls::MakeRustlsConnect::new(tls))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();
    let config = config::Config::from_env();

    let db = if config.database_url.trim().is_empty() {
        tracing::warn!(
            event = "api.db.disabled",
            "DATABASE_URL is empty; authorization will fail closed"
        );
        None
    } else {
        let mut pg = PgConfig::new();
        pg.url = Some(config.database_url.clone());
        pg.pool = Some(deadpool_postgres::PoolConfig::new(config.db_pool_max));
        if !config.database_tls_verify {
            tracing::warn!(
                event = "api.db.tls_verification_disabled",
                "Postgres TLS certificate verification is disabled"
            );
        }
        match postgres_tls(
            config.database_ca_cert_file.as_deref(),
            config.database_tls_verify,
        )
        .and_then(|tls| {
            pg.create_pool(Some(Runtime::Tokio1), tls)
                .map_err(Into::into)
        }) {
            Ok(pool) => {
                // Warm asynchronously: an unreachable remote database must not
                // prevent the HTTP listener (including /health) from starting.
                let warm_pool = pool.clone();
                tokio::spawn(async move {
                    if let Ok(Ok(client)) =
                        tokio::time::timeout(Duration::from_secs(3), warm_pool.get()).await
                    {
                        let _ = tokio::time::timeout(
                            Duration::from_secs(2),
                            client.query_opt("SELECT 1", &[]),
                        )
                        .await;
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
    let source = source::Source::new(
        config.source_base_url.clone(),
        config.source_cookie.clone(),
        cache,
        config.source_pacing_ms,
    );
    let state = routes::AppState {
        config: config.clone(),
        db,
        provider: provider::Provider::new(source),
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
