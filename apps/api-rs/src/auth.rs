//! Account authorization. Same SQL semantics as the TypeScript adapter: key lookup
//! with plan entitlement, then one atomic upsert that spends quota or reports
//! the retry delay. Prepared statements are cached by the pool.

use deadpool_postgres::Pool;
use sha2::{Digest, Sha256};
use tokio_postgres::error::SqlState;

#[derive(Debug, Clone)]
pub enum AccessDecision {
    Allowed { plan: String },
    Unauthorized,
    Unavailable,
    Limited { retry_after: i64 },
}

pub fn extract_key(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        let key = key.trim();
        if !key.is_empty() {
            return Some(key.to_string());
        }
    }
    let auth = headers.get("authorization")?.to_str().ok()?;
    let token = auth.strip_prefix("Bearer ").or_else(|| auth.strip_prefix("bearer "))?;
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

fn valid_format(secret: &str) -> bool {
    if !secret.starts_with("sm_live_") || secret.len() != 8 + 48 {
        return false;
    }
    secret[8..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn hash(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

pub async fn authorize(secret: Option<String>, pool: Option<&Pool>) -> AccessDecision {
    let secret = match secret {
        Some(s) if valid_format(&s) => s,
        _ => return AccessDecision::Unauthorized,
    };
    let pool = match pool {
        Some(p) => p,
        None => return AccessDecision::Unavailable,
    };
    let digest = hash(&secret);
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(event = "api.account_storage.unavailable", stage = "pool", error = %e);
            return AccessDecision::Unavailable;
        }
    };
    // Retry only the read before spending quota, so retries cannot count twice.
    let mut attempt = 0;
    let row = loop {
        let lookup = client
            .query_opt(
                "SELECT k.user_id, entitlement.plan AS api_plan,
                   COALESCE(p.request_limit, CASE entitlement.plan WHEN 'basic' THEN 60 WHEN 'personal' THEN 300 WHEN 'professional' THEN 500 ELSE 10 END) AS request_limit
                 FROM api_key k JOIN \"user\" u ON u.id = k.user_id
                 CROSS JOIN LATERAL (SELECT CASE WHEN u.plan_expires_at > now() AND u.api_plan IN ('basic', 'personal', 'professional') THEN u.api_plan ELSE 'free' END AS plan) entitlement
                 LEFT JOIN usage_policy p ON p.id = CASE WHEN entitlement.plan = 'free' THEN 'default' ELSE entitlement.plan END
                 WHERE k.key_hash = $1 AND k.revoked_at IS NULL
                   AND (k.expires_at IS NULL OR k.expires_at > now()) AND u.profile_completed = true
                 LIMIT 1",
                &[&digest],
            )
            .await;
        match lookup {
            Ok(row) => break row,
            Err(e) => {
                let too_many = e.code().map(|c| *c == SqlState::TOO_MANY_CONNECTIONS).unwrap_or(false);
                if !too_many || attempt >= 30 {
                    return AccessDecision::Unavailable;
                }
                attempt += 1;
                let jitter = 100 + (attempt as u64 * 37 % 200);
                tokio::time::sleep(std::time::Duration::from_millis(jitter)).await;
            }
        }
    };
    let row = match row {
        Some(r) => r,
        None => return AccessDecision::Unauthorized,
    };
    let user_id: String = row.get("user_id");
    let plan: String = row.get("api_plan");
    // usage_policy.request_limit is integer; pass i32 so the client encoding
    // matches the inferred parameter type exactly.
    let limit: i32 = row.get("request_limit");
    let spent = client
        .query_opt(
            "INSERT INTO account_usage (user_id, window_started_at, request_count)
             VALUES ($1, now(), 1)
             ON CONFLICT (user_id) DO UPDATE SET
               request_count = CASE WHEN account_usage.window_started_at <= now() - interval '1 minute'
                 THEN 1 ELSE account_usage.request_count + 1 END,
               window_started_at = CASE WHEN account_usage.window_started_at <= now() - interval '1 minute'
                 THEN now() ELSE account_usage.window_started_at END
             WHERE account_usage.window_started_at <= now() - interval '1 minute'
               OR account_usage.request_count < $2
             RETURNING user_id",
            &[&user_id, &limit],
        )
        .await
        .map_err(|e| {
            tracing::warn!(event = "api.account_storage.unavailable", stage = "quota", error = %e);
            e
        });
    match spent {
        Ok(Some(_)) => AccessDecision::Allowed { plan },
        Ok(None) => {
            let retry: Option<i64> = client
                .query_opt(
                    "SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_started_at + interval '1 minute' - now())))::integer AS retry_after
                     FROM account_usage WHERE user_id = $1",
                    &[&user_id],
                )
                .await
                .ok()
                .flatten()
                .map(|r| r.try_get::<_, i32>("retry_after").map(i64::from).unwrap_or(1));
            AccessDecision::Limited { retry_after: retry.unwrap_or(1) }
        }
        Err(_) => AccessDecision::Unavailable,
    }
}

pub fn has_detailed_data(plan: &str) -> bool {
    plan == "personal" || plan == "professional"
}
