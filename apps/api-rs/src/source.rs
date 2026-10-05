//! Upstream source client. Mirrors the TypeScript adapter: 15s timeout, retries
//! with backoff, shared response cache, login/markup validation and the exact
//! HTTP-status error mapping. One reqwest Client per process keeps upstream
//! connections warm across requests.

use crate::{
    cache::{source_cache_key, source_cache_ttl, CacheHit, SourceCache},
    error::{upstream_error, DataError},
};
use std::time::Duration;

#[derive(Clone)]
pub struct Source {
    pub client: reqwest::Client,
    pub base_url: String,
    pub cookie: String,
    pub cache: Option<SourceCache>,
    pub pacing_ms: u64,
}

impl Source {
    pub fn new(base_url: String, cookie: String, cache: Option<SourceCache>, pacing_ms: u64) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(16)
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36")
            .build()
            .expect("reqwest client");
        Self { client, base_url, cookie, cache, pacing_ms }
    }

    pub(crate) fn url(&self, path: &str) -> Result<url::Url, DataError> {
        let base = self.base_url.trim_end_matches('/');
        url::Url::parse(&format!("{base}{path}")).map_err(|_| upstream_error(None))
    }

    pub fn cache_key(&self, kind: &str, url: &url::Url) -> String {
        source_cache_key(kind, url, &self.cookie)
    }

    /// Fetch a URL with retries. Returns (body text, final URL, http status).
    pub async fn fetch_raw(&self, path: &str, ajax: bool) -> Result<(String, String, u16), DataError> {
        let url = self.url(path)?;
        let mut last_error: Option<DataError> = None;
        for attempt in 0..=3 {
            let request = self.client.get(url.clone()).header("Accept", "text/html, application/json");
            let request = if ajax { request.header("X-Requested-With", "XMLHttpRequest") } else { request };
            let request = if self.cookie.is_empty() { request } else { request.header("Cookie", &self.cookie) };
            match request.send().await {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let final_url = response.url().to_string();
                    // Retryable statuses go through backoff like the TS adapter.
                    if status == 408 || status == 429 || status >= 500 {
                        let retry_after = response.headers().get("retry-after").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
                        last_error = Some(upstream_error(Some(status)));
                        if attempt < 3 {
                            backoff(attempt, retry_after).await;
                            continue;
                        }
                        return Err(last_error.unwrap());
                    }
                    if status == 404 {
                        return Err(upstream_error(Some(404)));
                    }
                    if status == 429 {
                        return Err(upstream_error(Some(429)));
                    }
                    if !(200..300).contains(&status) {
                        return Err(upstream_error(Some(status)));
                    }
                    let text = response.text().await.map_err(|_| upstream_error(None))?;
                    if is_login_page(&text) {
                        return Err(DataError::new("The data source requires authentication", 502, "SOURCE_AUTH_REQUIRED"));
                    }
                    return Ok((text, final_url, status));
                }
                Err(_) => {
                    last_error = Some(upstream_error(None));
                    if attempt < 3 {
                        backoff(attempt, None).await;
                        continue;
                    }
                }
            }
        }
        Err(last_error.unwrap_or_else(|| upstream_error(None)))
    }

    /// Cached text fetch shared by all adapters. Validates markup like the TS
    /// adapter; validation failures are never cached.
    pub async fn get_text(&self, path: &str, ajax: bool) -> Result<CachedText, DataError> {
        let url = self.url(path)?;
        let ttl = source_cache_ttl(url.path());
        let loader = || async {
            let (text, _final_url, _status) = self.fetch_raw(path, ajax).await.map_err(|e| e.message.clone())?;
            validate_source_text(&url, &text).map_err(|e| e.message.clone())?;
            Ok(serde_json::Value::String(text))
        };
        match &self.cache {
            Some(cache) => {
                let key = self.cache_key("source", &url);
                let hit: CacheHit = cache.remember(&key, ttl, loader, None).await.map_err(|message| {
                    if message.contains("already being loaded") {
                        DataError::new(message, 503, "SOURCE_BUSY")
                    } else {
                        DataError::new(message, 502, "UPSTREAM_UNAVAILABLE")
                    }
                })?;
                let text = hit.value.as_str().unwrap_or("").to_string();
                Ok(CachedText { text, hit: hit.hit, expires_at_ms: hit.expires_at_ms })
            }
            None => {
                let value = loader().await.map_err(|m| DataError::new(m, 502, "UPSTREAM_UNAVAILABLE"))?;
                Ok(CachedText { text: value.as_str().unwrap_or("").to_string(), hit: false, expires_at_ms: 0 })
            }
        }
    }

    /// Cached JSON fetch for schedule/investor detail endpoints, with the
    /// strict shape validation of the TypeScript adapter.
    pub async fn get_json(&self, path: &str) -> Result<serde_json::Value, DataError> {
        let text = self.get_text(path, true).await?.text;
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| DataError::new("Source detail rows could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"))?;
        match &value {
            serde_json::Value::Object(map) if map.values().all(|v| v.is_object()) => Ok(value),
            _ => Err(DataError::new("Source detail row format changed", 502, "UPSTREAM_SCHEMA_CHANGED")),
        }
    }

    pub async fn pace(&self) {
        if self.pacing_ms > 0 {
            tokio::time::sleep(Duration::from_millis(self.pacing_ms)).await;
        }
    }
}

#[derive(Debug, Clone)]
pub struct CachedText {
    pub text: String,
    pub hit: bool,
    #[allow(dead_code)]
    pub expires_at_ms: i64,
}

fn is_login_page(text: &str) -> bool {
    let lower = text.to_lowercase();
    (lower.contains("<title>") && (lower.contains("login") || lower.contains("sign in") || lower.contains("register")))
        || lower.contains("form") && login_action(&lower)
}

fn login_action(lower: &str) -> bool {
    // form[^>]+action=["'][^"']*login — small manual scan, no regex engine.
    let mut rest = lower;
    while let Some(i) = rest.find("<form") {
        rest = &rest[i + 5..];
        let tag_end = rest.find('>').unwrap_or(rest.len());
        let tag = &rest[..tag_end];
        if tag.contains("action=") && tag.contains("login") {
            return true;
        }
    }
    false
}

pub fn validate_source_text(url: &url::Url, text: &str) -> Result<(), DataError> {
    if is_login_page(text) {
        return Err(DataError::new("The data source requires authentication.", 502, "SOURCE_AUTH_REQUIRED"));
    }
    let path = url.path();
    if path.contains("/schedules/") || path.contains("/investors/") {
        let rows: Result<serde_json::Value, _> = serde_json::from_str(text);
        match rows {
            Ok(serde_json::Value::Object(map)) if map.values().all(|v| v.is_object()) => {}
            _ => return Err(DataError::new("Source detail row format changed", 502, "UPSTREAM_SCHEMA_CHANGED")),
        }
    }
    if path == "/api/company/search/" {
        let rows: Result<serde_json::Value, _> = serde_json::from_str(text);
        if !matches!(rows, Ok(serde_json::Value::Array(_))) {
            return Err(DataError::new("Source search format changed", 502, "UPSTREAM_SCHEMA_CHANGED"));
        }
    }
    let lower = text.to_lowercase();
    let expected: Option<&str> = if path.starts_with("/company/actions/") {
        Some("corporate-actions-")
    } else if path.starts_with("/actions/") || path.starts_with("/upcoming-results/") {
        Some("result_list")
    } else if path.ends_with("/peers") || path.ends_with("/peers/") {
        Some("<table")
    } else {
        None
    };
    if let Some(marker) = expected {
        if !lower.contains(marker) {
            return Err(DataError::new("Source table format changed", 502, "UPSTREAM_SCHEMA_CHANGED"));
        }
    }
    Ok(())
}

async fn backoff(attempt: u32, retry_after: Option<String>) {
    let delay_ms = match retry_after {
        Some(s) => s.parse::<f64>().map(|s| (s * 1000.0) as u64).unwrap_or(1000 * 2u64.pow(attempt)),
        None => 1000 * 2u64.pow(attempt),
    };
    tokio::time::sleep(Duration::from_millis(delay_ms.min(30_000))).await;
}
