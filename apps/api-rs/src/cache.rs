//! Valkey read-through cache with distributed locks and in-process request
//! coalescing. Same key derivation, TTLs and JSON envelope as the TypeScript
//! adapter, so both implementations share cache entries.

use redis::{aio::ConnectionManager, AsyncCommands, RedisError};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, OnceCell};

pub const COMPANY_CACHE_TTL: i64 = 15 * 60;
pub const DETAIL_CACHE_TTL: i64 = 6 * 60 * 60;

#[derive(Debug, Clone)]
pub struct CacheHit {
    pub value: Value,
    pub hit: bool,
    pub expires_at_ms: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// sha256 of [normalized href, cookie], exactly like sourceCacheKey.
pub fn source_cache_key(kind: &str, url: &url::Url, cookie: &str) -> String {
    let mut normalized = url.clone();
    if normalized.path().contains("/schedules/") {
        let pairs: Vec<(String, String)> = normalized
            .query_pairs()
            .filter(|(k, v)| !(k == "consolidated" && v.is_empty()))
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        if pairs.is_empty() {
            normalized.set_query(None);
        } else {
            let mut sorted = pairs;
            sorted.sort();
            normalized
                .query_pairs_mut()
                .clear()
                .extend_pairs(sorted.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        }
    }
    // url crate keeps query pairs sorted only if we sort them ourselves.
    let mut without_sort = normalized.clone();
    {
        let pairs: Vec<(String, String)> = without_sort
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let mut sorted = pairs;
        sorted.sort();
        without_sort.query_pairs_mut().clear().extend_pairs(
            sorted.iter().map(|(k, v)| (k.as_str(), v.as_str())),
        );
    }
    let payload = serde_json::to_string(&vec![
        Value::String(without_sort.to_string()),
        Value::String(cookie.to_string()),
    ])
    .unwrap_or_default();
    format!("{kind}:{}", hex::encode(Sha256::digest(payload.as_bytes())))
}

pub fn source_cache_ttl(path: &str) -> i64 {
    if path.contains("/schedules/") || path.contains("/investors/") {
        return DETAIL_CACHE_TTL;
    }
    if path == "/api/company/search/" {
        return 24 * 60 * 60;
    }
    if path.starts_with("/ipo") || path == "/cloud/v2/index/gmp-data" {
        return 5 * 60;
    }
    if path.starts_with("/actions/") || path.starts_with("/company/actions/") || path.starts_with("/upcoming-results/") {
        return 30 * 60;
    }
    COMPANY_CACHE_TTL
}

type SharedLoad = Arc<OnceCell<Result<CacheHit, String>>>;

#[derive(Clone)]
pub struct SourceCache {
    manager: Option<ConnectionManager>,
    prefix: String,
    pending: Arc<Mutex<HashMap<String, SharedLoad>>>,
}

impl SourceCache {
    pub async fn new(valkey_url: Option<&str>, prefix: String) -> Self {
        // ConnectionManager connects lazily on first command; a down cache
        // only degrades to direct loads, never to request errors.
        let mut manager = None;
        if let Some(url) = valkey_url {
            if let Ok(client) = redis::Client::open(url) {
                manager = ConnectionManager::new(client).await.ok();
            }
        }
        Self { manager, prefix, pending: Arc::new(Mutex::new(HashMap::new())) }
    }

    fn full_key(&self, key: &str) -> String {
        format!("{}:v1:{key}", self.prefix)
    }

    async fn read(&self, full_key: &str) -> Option<CacheHit> {
        let mut manager = self.manager.clone()?;
        let raw: Option<String> = manager.get(full_key).await.ok()?;
        let entry: Value = serde_json::from_str(&raw?).ok()?;
        if entry.get("version")?.as_u64()? != 1 {
            return None;
        }
        let expires_at = entry.get("expiresAt")?.as_i64()?;
        if expires_at <= now_ms() {
            return None;
        }
        Some(CacheHit { value: entry.get("value")?.clone(), hit: true, expires_at_ms: expires_at })
    }

    /// Cache-aside remember with cross-request locking and in-process
    /// coalescing. Loader failures propagate and are never stored.
    pub async fn remember<F, Fut>(
        &self,
        key: &str,
        ttl_secs: i64,
        load: F,
        dependency_expiry_ms: Option<i64>,
    ) -> Result<CacheHit, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let full_key = self.full_key(key);
        let cell = {
            let mut pending = self.pending.lock().await;
            pending
                .entry(full_key.clone())
                .or_insert_with(|| Arc::new(OnceCell::new()))
                .clone()
        };
        let outcome = cell
            .get_or_init(|| async {
                let result = self.load_once(&full_key, ttl_secs, load, dependency_expiry_ms).await;
                result.map_err(|e| e.clone())
            })
            .await;
        {
            let mut pending = self.pending.lock().await;
            if let Some(existing) = pending.get(&full_key) {
                if Arc::ptr_eq(existing, &cell) {
                    pending.remove(&full_key);
                }
            }
        }
        outcome.clone()
    }

    async fn load_once<F, Fut>(
        &self,
        full_key: &str,
        ttl_secs: i64,
        load: F,
        dependency_expiry_ms: Option<i64>,
    ) -> Result<CacheHit, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let token = uuid::Uuid::new_v4().to_string();
        let mut acquired = false;
        let mut manager = self.manager.clone();
        if let Some(m) = manager.as_mut() {
            let deadline = now_ms() + 30_000;
            loop {
                if let Some(cached) = self.read(full_key).await {
                    return Ok(cached);
                }
                match acquire_lock(m, full_key, &token, 120_000).await {
                    Ok(true) => {
                        acquired = true;
                        break;
                    }
                    Ok(false) => {
                        if now_ms() >= deadline {
                            return Err("Source data is already being loaded; retry later".to_string());
                        }
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                    Err(_) => break,
                }
            }
            if acquired {
                if let Some(cached) = self.read(full_key).await {
                    let _ = release_lock(m, full_key, &token).await;
                    return Ok(cached);
                }
            }
        }
        let value = match load().await {
            Ok(v) => v,
            Err(e) => {
                if acquired {
                    if let Some(m) = manager.as_mut() {
                        let _ = release_lock(m, full_key, &token).await;
                    }
                }
                return Err(e);
            }
        };
        let expires_at = (now_ms() + ttl_secs * 1000).min(dependency_expiry_ms.unwrap_or(i64::MAX));
        if acquired {
            if let Some(m) = manager.as_mut() {
                if expires_at > now_ms() {
                    let body = serde_json::json!({ "version": 1, "value": value, "expiresAt": expires_at }).to_string();
                    let _ = publish(m, full_key, &token, &body, expires_at - now_ms()).await;
                }
                let _ = release_lock(m, full_key, &token).await;
            }
        }
        Ok(CacheHit { value, hit: false, expires_at_ms: expires_at })
    }
}

async fn acquire_lock(m: &mut ConnectionManager, key: &str, token: &str, lease_ms: i64) -> Result<bool, RedisError> {
    let lock = format!("{key}:lock");
    let set: Option<String> = redis::cmd("SET")
        .arg(&lock)
        .arg(token)
        .arg("NX")
        .arg("PX")
        .arg(lease_ms)
        .query_async(m)
        .await?;
    Ok(set.as_deref() == Some("OK"))
}

async fn publish(m: &mut ConnectionManager, key: &str, token: &str, value: &str, ttl_ms: i64) -> Result<(), RedisError> {
    let lock = format!("{key}:lock");
    let _: Option<String> = redis::cmd("EVAL")
        .arg("if redis.call('GET', KEYS[2]) == ARGV[1] then return redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) end return nil")
        .arg(2)
        .arg(key)
        .arg(&lock)
        .arg(token)
        .arg(value)
        .arg(ttl_ms.max(1))
        .query_async(m)
        .await?;
    Ok(())
}

async fn release_lock(m: &mut ConnectionManager, key: &str, token: &str) -> Result<(), RedisError> {
    let lock = format!("{key}:lock");
    let _: i32 = redis::cmd("EVAL")
        .arg("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0")
        .arg(1)
        .arg(&lock)
        .arg(token)
        .query_async(m)
        .await?;
    Ok(())
}
