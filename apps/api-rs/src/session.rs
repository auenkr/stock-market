//! Source login session. Logs in with SOURCE_USERNAME/SOURCE_PASSWORD, keeps
//! the cookie in memory and in a temp file, and re-logs in when it expires.

use crate::error::DataError;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::{Mutex, RwLock};

#[derive(Clone)]
pub struct Session {
    base_url: String,
    credentials: Option<(String, String)>,
    cookie: Arc<RwLock<String>>,
    login_lock: Arc<Mutex<()>>,
    path: PathBuf,
}

impl Session {
    pub fn new(base_url: &str, credentials: Option<(String, String)>) -> Self {
        let path = std::env::temp_dir().join("stock-market-source-session");
        // Restart: reuse the persisted cookie before trying a fresh login.
        let cookie = if credentials.is_some() {
            let loaded = std::fs::read_to_string(&path).map(|s| s.trim().to_string()).unwrap_or_default();
            if loaded.is_empty() {
                tracing::info!(event = "api.source.session_file_missing", path = %path.display());
            } else {
                tracing::info!(event = "api.source.session_loaded", path = %path.display());
            }
            loaded
        } else {
            String::new()
        };
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            credentials,
            cookie: Arc::new(RwLock::new(cookie)),
            login_lock: Arc::new(Mutex::new(())),
            path,
        }
    }

    pub fn can_login(&self) -> bool {
        self.credentials.is_some()
    }

    /// Current cookie; logs in first when none is stored yet.
    pub async fn cookie(&self) -> String {
        let current = self.cookie.read().await.clone();
        if current.is_empty() && self.can_login() {
            return self.refresh(&current).await.unwrap_or_default();
        }
        current
    }

    /// Re-login after `stale` was rejected. If another task already replaced
    /// the cookie, reuse it instead of logging in again.
    pub async fn refresh(&self, stale: &str) -> Result<String, DataError> {
        let _guard = self.login_lock.lock().await;
        let current = self.cookie.read().await.clone();
        if !current.is_empty() && current != stale {
            return Ok(current);
        }
        tracing::info!(event = "api.source.login_started", refresh = !stale.is_empty());
        let cookie = self.login().await?;
        *self.cookie.write().await = cookie.clone();
        match std::fs::write(&self.path, &cookie) {
            Ok(()) => tracing::info!(event = "api.source.session_saved", path = %self.path.display()),
            Err(error) => tracing::warn!(event = "api.source.session_persist_failed", path = %self.path.display(), error = %error),
        }
        Ok(cookie)
    }

    async fn login(&self) -> Result<String, DataError> {
        let fail = |message: &str| DataError::new(message.to_string(), 502, "SOURCE_AUTH_REQUIRED");
        let (username, password) = self.credentials.clone().ok_or_else(|| fail("No source credentials configured"))?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36")
            .build()
            .map_err(|_| fail("Source login failed"))?;
        let login_url = format!("{}/login/", self.base_url);

        let page = client.get(&login_url).send().await.map_err(|_| fail("Source login page unreachable"))?;
        let mut cookies = collect_cookies(&page);
        let html = page.text().await.map_err(|_| fail("Source login page unreadable"))?;
        let token = csrf_token(&html).ok_or_else(|| fail("Source login form changed"))?;

        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("csrfmiddlewaretoken", &token)
            .append_pair("username", &username)
            .append_pair("password", &password)
            .finish();
        let response = client
            .post(&login_url)
            .header("content-type", "application/x-www-form-urlencoded")
            .header("origin", &self.base_url)
            .header("referer", &login_url)
            .header("cookie", join(&cookies))
            .body(body)
            .send()
            .await
            .map_err(|_| fail("Source login request failed"))?;
        for (name, value) in collect_cookies(&response) {
            cookies.retain(|(n, _)| *n != name);
            cookies.push((name, value));
        }
        // Success redirects away and issues sessionid; failure re-renders the form.
        if !cookies.iter().any(|(n, _)| n == "sessionid") {
            tracing::warn!(event = "api.source.login_failed", status = response.status().as_u16());
            return Err(fail("Source login rejected the configured credentials"));
        }
        tracing::info!(event = "api.source.login_succeeded");
        Ok(join(&cookies))
    }
}

fn collect_cookies(response: &reqwest::Response) -> Vec<(String, String)> {
    response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .filter_map(|pair| pair.split_once('='))
        .filter(|(_, value)| !value.is_empty())
        .map(|(n, v)| (n.trim().to_string(), v.trim().to_string()))
        .collect()
}

fn join(cookies: &[(String, String)]) -> String {
    cookies.iter().map(|(n, v)| format!("{n}={v}")).collect::<Vec<_>>().join("; ")
}

fn csrf_token(html: &str) -> Option<String> {
    let doc = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("input[type='hidden'][name='csrfmiddlewaretoken']").ok()?;
    doc.select(&selector).next()?.value().attr("value").map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::csrf_token;

    #[test]
    fn extracts_csrf_token() {
        let html = r#"<form><input type="hidden" name="csrfmiddlewaretoken" value="abc123"></form>"#;
        assert_eq!(csrf_token(html).as_deref(), Some("abc123"));
    }
}
