//! Error taxonomy. Mirrors the TypeScript DataError/SourceError status codes and
//! the exact JSON envelopes so the HTTP contract is identical.

use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug, Clone)]
pub struct DataError {
    pub message: String,
    pub status: u16,
    pub code: String,
}

impl DataError {
    pub fn new(message: impl Into<String>, status: u16, code: impl Into<String>) -> Self {
        Self { message: message.into(), status, code: code.into() }
    }

    pub fn dataset_unavailable(message: impl Into<String>) -> Self {
        Self::new(message, 501, "DATASET_UNAVAILABLE")
    }

    fn status_code(&self) -> StatusCode {
        StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    }

    /// Compatibility envelope: { error, code, endpoint, docs }.
    pub fn into_compat_response(self, endpoint: &str) -> Response {
        let status = self.status_code();
        let body = Json(json!({
            "error": self.message,
            "code": self.code,
            "endpoint": endpoint,
            "docs": "/v1/coverage",
        }));
        (status, [("Cache-Control", "no-store")], body).into_response()
    }

    /// Legacy envelope: { error, code }.
    pub fn into_legacy_response(self) -> Response {
        let status = self.status_code();
        let body = Json(json!({ "error": self.message, "code": self.code }));
        (status, [("Cache-Control", "no-store")], body).into_response()
    }
}

/// Legacy adapters derive the code from the message text.
pub fn legacy_code(message: &str) -> String {
    message.to_uppercase().replace(|c: char| c.is_whitespace(), "_")
}

pub fn legacy_error(message: impl Into<String>, status: u16) -> DataError {
    let message = message.into();
    let code = legacy_code(&message);
    DataError::new(message, status, code)
}

/// Upstream fetch failures mapped exactly like the TypeScript provider.
pub fn upstream_error(http_status: Option<u16>) -> DataError {
    match http_status {
        Some(404) => DataError::new("Company or source resource not found", 404, "NOT_FOUND"),
        Some(429) => DataError::new("Data source request limit reached; retry later", 503, "SOURCE_RATE_LIMITED"),
        Some(s) => DataError::new(format!("The data source returned HTTP {s}"), 502, "UPSTREAM_UNAVAILABLE"),
        None => DataError::new("The data source could not be reached", 502, "UPSTREAM_UNAVAILABLE"),
    }
}

#[allow(dead_code)]
pub fn invalid_query(message: impl Into<String>) -> DataError {
    DataError::new(message, 400, "INVALID_QUERY")
}

/// Encode a DataError as a cache-loader string and back, so typed failures
/// survive the string-typed cache boundary without losing status/code.
pub fn encode_error(e: &DataError) -> String {
    format!("{}:{}:{}", e.status, e.code, e.message)
}

pub fn decode_error(s: &str) -> DataError {
    if s.contains("already being loaded") {
        return DataError::new(s, 503, "SOURCE_BUSY");
    }
    let mut parts = s.splitn(3, ':');
    let status = parts.next().and_then(|p| p.parse::<u16>().ok());
    let code = parts.next();
    let message = parts.next();
    match (status, code, message) {
        (Some(status), Some(code), Some(message)) => DataError::new(message, status, code),
        _ => DataError::new(s, 502, "UPSTREAM_UNAVAILABLE"),
    }
}

/// Fallback for unexpected failures.
#[allow(dead_code)]
pub fn internal_failure() -> Response {
    internal_json()
}

fn internal_json() -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal Server Error", "code": "INTERNAL_SERVER_ERROR" }))).into_response()
}
