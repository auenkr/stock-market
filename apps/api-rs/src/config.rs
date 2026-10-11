//! Public server configuration and optional Valkey source cache.

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub environment: String,
    pub valkey_url: Option<String>,
    pub valkey_prefix: String,
    pub source_base_url: String,
    pub source_cookie: String,
    /// Politeness delay after uncached upstream detail fetches (ms). Matches
    /// the TypeScript adapter default; tests set it to 0.
    pub source_pacing_ms: u64,
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

impl Config {
    pub fn from_env() -> Self {
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
            source_cookie: std::env::var("SOURCE_COOKIE").unwrap_or_default(),
            source_pacing_ms: env("SOURCE_PACING_MS", "1200").parse().unwrap_or(1200),
        }
    }

    pub fn cache_enabled(&self) -> bool {
        self.valkey_url.is_some()
    }
}
