//! Upstream source client. Mirrors the TypeScript adapter: 15s timeout, retries
//! with backoff, shared response cache, login/markup validation and the exact
//! HTTP-status error mapping. One reqwest Client per process keeps upstream
//! connections warm across requests.

use crate::{
    session::Session,
    cache::{source_cache_key, source_cache_ttl, CacheHit, SourceCache},
    error::{upstream_error, DataError},
};
use std::time::Duration;

#[derive(Clone)]
pub struct Source {
    pub client: reqwest::Client,
    pub base_url: String,
    pub session: Session,
    pub cache: Option<SourceCache>,
    pub pacing_ms: u64,
}

impl Source {
    pub fn new(base_url: String, credentials: Option<(String, String)>, cache: Option<SourceCache>, pacing_ms: u64) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(16)
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36")
            .build()
            .expect("reqwest client");
        let session = Session::new(&base_url, credentials);
        Self { client, base_url, session, cache, pacing_ms }
    }

    pub(crate) fn url(&self, path: &str) -> Result<url::Url, DataError> {
        let base = self.base_url.trim_end_matches('/');
        url::Url::parse(&format!("{base}{path}")).map_err(|_| upstream_error(None))
    }

    pub fn cache_key(&self, kind: &str, url: &url::Url) -> String {
        source_cache_key(kind, url, "")
    }

    /// Fetch with the session cookie; on an expired session, log in again once and retry.
    pub async fn fetch_raw(&self, path: &str, ajax: bool) -> Result<(String, String, u16), DataError> {
        let cookie = self.session.cookie().await;
        match self.fetch_with(path, ajax, &cookie).await {
            Err(error) if error.code == "SOURCE_AUTH_REQUIRED" && self.session.can_login() => {
                let fresh = self.session.refresh(&cookie).await?;
                self.fetch_with(path, ajax, &fresh).await
            }
            result => result,
        }
    }

    /// Fetch a URL with retries. Returns (body text, final URL, http status).
    async fn fetch_with(&self, path: &str, ajax: bool, cookie: &str) -> Result<(String, String, u16), DataError> {
        let url = self.url(path)?;
        let source_path = url.path().to_string();
        let mut last_error: Option<DataError> = None;
        for attempt in 0..=3 {
            let request = self.client.get(url.clone()).header("Accept", "text/html, application/json");
            let request = if ajax { request.header("X-Requested-With", "XMLHttpRequest") } else { request };
            let request = if cookie.is_empty() { request } else { request.header("Cookie", cookie) };
            match request.send().await {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let final_url = response.url().to_string();
                    // Retryable statuses go through backoff like the TS adapter.
                    if status == 408 || status == 429 || status >= 500 {
                        tracing::warn!(
                            event = "api.source.http_error",
                            path = %source_path,
                            response_path = %response.url().path(),
                            status,
                            attempt = attempt + 1
                        );
                        let retry_after = response.headers().get("retry-after").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
                        last_error = Some(upstream_error(Some(status)));
                        if attempt < 3 {
                            backoff(attempt, retry_after).await;
                            continue;
                        }
                        return Err(last_error.unwrap());
                    }
                    if status == 404 {
                        tracing::warn!(event = "api.source.http_error", path = %source_path, status, attempt = attempt + 1);
                        return Err(upstream_error(Some(404)));
                    }
                    if status == 429 {
                        tracing::warn!(event = "api.source.http_error", path = %source_path, status, attempt = attempt + 1);
                        return Err(upstream_error(Some(429)));
                    }
                    if !(200..300).contains(&status) {
                        tracing::warn!(event = "api.source.http_error", path = %source_path, status, attempt = attempt + 1);
                        return Err(upstream_error(Some(status)));
                    }
                    let text = response.text().await.map_err(|_| upstream_error(None))?;
                    if is_login_page(&text) {
                        let response_path = url::Url::parse(&final_url)
                            .map(|url| url.path().to_string())
                            .unwrap_or_default();
                        tracing::warn!(
                            event = "api.source.authentication_required",
                            path = %source_path,
                            response_path = %response_path,
                            status,
                            cookie_present = !cookie.is_empty(),
                            attempt = attempt + 1
                        );
                        return Err(DataError::new("The data source requires authentication", 502, "SOURCE_AUTH_REQUIRED"));
                    }
                    tracing::debug!(event = "api.source.fetch_succeeded", path = %source_path, status, attempt = attempt + 1);
                    return Ok((text, final_url, status));
                }
                Err(error) => {
                    tracing::warn!(
                        event = "api.source.transport_error",
                        path = %source_path,
                        attempt = attempt + 1,
                        timeout = error.is_timeout(),
                        connect = error.is_connect(),
                        error = %error
                    );
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
    title_indicates_login(&lower) || login_action(&lower)
}

fn title_indicates_login(lower: &str) -> bool {
    let Some(title_tag) = lower.find("<title") else {
        return false;
    };
    let Some(title_content_offset) = lower[title_tag..].find('>') else {
        return false;
    };
    let title_start = title_tag + title_content_offset + 1;
    let Some(title_end_offset) = lower[title_start..].find("</title>") else {
        return false;
    };
    let title = &lower[title_start..title_start + title_end_offset];
    title.contains("login") || title.contains("sign in") || title.contains("register")
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

#[cfg(test)]
mod tests {
    use super::is_login_page;

    #[test]
    fn company_page_with_login_and_register_links_is_not_a_login_page() {
        let html = r#"<!doctype html><html><head><title>Reliance Industries Ltd share price</title></head>
            <body><a href="/login/">Login</a><a href="/register/">Register</a>
            <form action="/search/"></form></body></html>"#;

        assert!(!is_login_page(html));
    }

    #[test]
    fn login_title_is_detected() {
        assert!(is_login_page("<html><head><title>Login - Screener</title></head></html>"));
    }

    #[test]
    fn login_form_action_is_detected() {
        assert!(is_login_page("<html><form action=\"/account/login/\"></form></html>"));
    }
}

async fn backoff(attempt: u32, retry_after: Option<String>) {
    let delay_ms = match retry_after {
        Some(s) => s.parse::<f64>().map(|s| (s * 1000.0) as u64).unwrap_or(1000 * 2u64.pow(attempt)),
        None => 1000 * 2u64.pow(attempt),
    };
    tokio::time::sleep(Duration::from_millis(delay_ms.min(30_000))).await;
}
