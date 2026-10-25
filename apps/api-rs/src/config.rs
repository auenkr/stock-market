//! Public server configuration and optional Valkey source cache.

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub environment: String,
    pub valkey_url: Option<String>,
    pub valkey_prefix: String,
    pub source_base_url: String,
    pub source_username: String,
    pub source_password: String,
    /// Politeness delay after uncached upstream detail fetches (ms). Matches
    /// the TypeScript adapter default; tests set it to 0.
    pub source_pacing_ms: u64,
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

impl Config {
    pub fn from_env() -> Self {
        // Local runs: read the nearest .env (searches parent dirs). Real env vars win.
        let _ = dotenvy::dotenv();
        let environment = env("ENVIRONMENT", "production");
        let default_prefix = format!("stock-market:{environment}");
        Self {
            port: env("PORT", "3000").parse().unwrap_or(3000),
            environment,
            valkey_url: std::env::var("VALKEY_URL")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            valkey_prefix: env("VALKEY_CACHE_PREFIX", &default_prefix),
            source_base_url: env("SOURCE_BASE_URL", "https://www.screener.in"),
            source_username: env("SOURCE_USERNAME", ""),
            source_password: env("SOURCE_PASSWORD", ""),
            source_pacing_ms: env("SOURCE_PACING_MS", "1200").parse().unwrap_or(1200),
        }
    }

    /// Login credentials, when both are configured.
    pub fn source_credentials(&self) -> Option<(String, String)> {
        (!self.source_username.is_empty() && !self.source_password.is_empty())
            .then(|| (self.source_username.clone(), self.source_password.clone()))
    }

    pub fn cache_enabled(&self) -> bool {
        self.valkey_url.is_some()
    }
}
