//! Public user-journey endpoints only; internal endpoints are deliberately omitted.
use super::*;

struct TestApp {
    base: String,
    client: reqwest::Client,
    servers: Vec<tokio::task::JoinHandle<()>>,
}

impl Drop for TestApp {
    fn drop(&mut self) {
        for server in &self.servers {
            server.abort();
        }
    }
}

impl TestApp {
    async fn new() -> Self {
        let fixture = axum::Router::new()
            .route("/api/company/search/", get(|| async {
                Json(json!([{ "name": "Acme Ltd", "url": "/company/ACME/" }]))
            }))
            .route("/company/ACME/", get(|| async {
                Html(r#"<div id="company-info" data-company-id="1" data-warehouse-id="1"></div><section id="top"><h1>Acme Ltd</h1></section>"#)
            }))
            .route("/api/company/1/peers", get(|| async { Html(TABLE) }))
            .route("/screens/357649/all-listed-companies/", get(|| async {
                Html(r#"<table class="data-table"><tbody><tr><td>1</td><td><a href="/company/ACME/">Acme Ltd</a></td><td>100</td><td>10</td><td>1234.5</td><td>1</td><td>20</td><td>2</td><td>200</td><td>3</td><td>15</td></tr></tbody></table>"#)
            }))
            .route("/screen/raw/", get(|| async { Html(TABLE) }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source_base = format!("http://{}", listener.local_addr().unwrap());
        let fixture_server = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
        // Explicit configuration avoids reading .env, real credentials, or Valkey.
        let config = Config {
            port: 0,
            environment: "production".into(),
            valkey_url: None,
            valkey_prefix: "public-endpoint-tests".into(),
            source_base_url: source_base.clone(),
            source_username: String::new(),
            source_password: String::new(),
            source_pacing_ms: 0,
            ipo_base_url: source_base.clone(),
        };
        let state = AppState {
            config,
            provider: Provider::new(crate::source::Source::new(source_base.clone(), None, None, 0)),
            ipo: crate::ipo::Ipo::new(source_base, None),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
        Self {
            base,
            client: reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)).build().unwrap(),
            servers: vec![fixture_server, server],
        }
    }

    async fn get(&self, path: &str, status: u16) -> Value {
        let response = self.client.get(format!("{}{path}", self.base)).send().await.unwrap();
        assert_eq!(response.status().as_u16(), status, "{path}");
        let headers = response.headers();
        assert!(uuid::Uuid::parse_str(headers["x-request-id"].to_str().unwrap()).is_ok(), "{path}");
        assert_eq!(headers["access-control-allow-origin"], "*", "{path}");
        assert_eq!(headers["cache-control"], "no-store", "{path}");
        if status == 200 && !path.contains("company-search") && !path.contains("list-of-company") {
            assert_eq!(headers["x-data-coverage"], "partial", "{path}");
            assert_eq!(headers.get_all("x-data-coverage").iter().count(), 1, "{path}");
            assert!(!headers.contains_key("x-data-source"), "{path}");
        }
        response.json().await.unwrap()
    }
}

const TABLE: &str = r#"<table class="data-table"><thead><tr><th>Company</th><th>Market Capitalization</th></tr></thead><tbody><tr data-row-company-id="1"><td><a href="/company/ACME/">Acme Ltd</a></td><td>1,234.5</td></tr></tbody></table>"#;

const COMPANY_CASES: &[(&str, &str)] = &[
    ("company-profile", "/name"),
    ("basic-financials", "/basicFinance"),
    ("company-documents", "/documents/annualReports"),
    ("peer-comparison", "/peers"),
    ("quarterly-profit-loss", "/financials"),
    ("profit-loss", "/financials"),
    ("balance-sheet", "/financials"),
    ("cash-flow", "/financials"),
    ("ratios", "/ratios"),
    ("shareholding-pattern", "/rows"),
    ("shareholdings/distribution", "/distributions"),
];

#[test]
fn case_table_covers_every_public_dataset() {
    let expected: std::collections::HashSet<_> = endpoint_catalog()
        .into_iter()
        .filter(|contract| contract.status != "excluded" && endpoint_use_case(contract.path) != "internal")
        .map(|contract| contract.resource)
        .collect();
    let actual: std::collections::HashSet<_> = COMPANY_CASES.iter()
        .map(|(resource, _)| *resource)
        .chain(std::iter::once("screen"))
        .collect();
    assert_eq!(actual, expected, "Update the test cases when public datasets change");
}

#[tokio::test]
async fn public_company_routes_return_partial_data_for_both_aliases() {
    let app = TestApp::new().await;
    for &(resource, pointer) in COMPANY_CASES {
        let mut canonical = None;
        for prefix in ["/api/v1", "/v1"] {
            let path = format!("{prefix}/{resource}?symbol=/company/ACME/");
            let body = app.get(&path, 200).await;
            assert!(body.pointer(pointer).is_some(), "{path}: missing {pointer}: {body}");
            let symbol_key = if resource == "shareholding-pattern" { "stock_symbol" } else { "symbol" };
            assert_eq!(body[symbol_key], "/company/ACME/", "{path}");
            if let Some(expected) = &canonical {
                assert_eq!(&body, expected, "{path}: alias must preserve the response");
            }
            canonical = Some(body);
        }
    }
}

#[tokio::test]
async fn public_company_routes_reject_invalid_queries() {
    let app = TestApp::new().await;
    let cases = [
        ("", "symbol parameter is required"),
        ("?symbol=", "symbol parameter is required"),
        ("?symbol=%20", "symbol parameter is required"),
        ("?symbol=ACME", "symbol must be a single company URL path"),
        ("?symbol=https://example.com/company/ACME/", "symbol must be a single company URL path"),
        ("?symbol=/company/ACME/&symbol=/company/OTHER/", "symbol must be a single company URL path"),
        ("?symbol=/company/ACME/&unknown=x", "Unknown query parameter: unknown"),
        ("?symbol=/company/ACME/&period=annual", "Unknown query parameter: period"),
    ];
    for &(resource, _) in COMPANY_CASES {
        for prefix in ["/api/v1", "/v1"] {
            for (query, error) in cases {
                let path = format!("{prefix}/{resource}{query}");
                let body = app.get(&path, 400).await;
                assert_eq!(body, json!({ "error": error, "code": "INVALID_QUERY",
                    "endpoint": format!("/api/v1/{resource}"), "docs": "/v1/coverage" }), "{path}");
            }
        }
    }
}

#[tokio::test]
async fn public_discovery_routes_validate_queries_and_return_companies() {
    let app = TestApp::new().await;
    for prefix in ["/v1", "/api"] {
        for query in ["", "?q=", "?q=%20"] {
            let path = format!("{prefix}/company-search{query}");
            assert_eq!(app.get(&path, 400).await, json!({
                "error": "q parameter is required", "code": "Q_PARAMETER_IS_REQUIRED"
            }), "{path}");
        }
        for page in ["0", "-1", "1.5", "abc", "9007199254740992"] {
            let path = format!("{prefix}/list-of-company?page={page}");
            assert_eq!(app.get(&path, 400).await, json!({
                "error": "page must be a positive integer", "code": "PAGE_MUST_BE_A_POSITIVE_INTEGER"
            }), "{path}");
        }
        let search = app.get(&format!("{prefix}/company-search?q=acme"), 200).await;
        assert_eq!(search["data"][0]["symbol"], "/company/ACME/");
        assert_eq!(search["data"], search["results"]);
        let list = app.get(&format!("{prefix}/list-of-company?page=1"), 200).await;
        assert_eq!(list["data"][0]["symbol"], "/company/ACME/");
        assert_eq!(list["meta"]["currentPage"], 1);
        assert_eq!(list["meta"]["count"], 1);
    }
}

#[tokio::test]
async fn public_screen_routes_validate_queries_and_return_matches() {
    let app = TestApp::new().await;
    let cases = [
        (String::new(), "Only one query parameter is accepted"),
        ("?query=".into(), "query must be a non-empty string of at most 4000 characters"),
        ("?query=%20".into(), "query must be a non-empty string of at most 4000 characters"),
        ("?query=a&query=b".into(), "Only one query parameter is accepted"),
        ("?query=a&symbol=/company/ACME/".into(), "Only one query parameter is accepted"),
        (format!("?query={}", "a".repeat(4001)), "query must be a non-empty string of at most 4000 characters"),
    ];
    for prefix in ["/api/v1", "/v1"] {
        for (query, error) in &cases {
            let path = format!("{prefix}/screen{query}");
            assert_eq!(app.get(&path, 400).await, json!({ "error": error, "code": "INVALID_QUERY",
                "endpoint": "/api/v1/screen", "docs": "/v1/coverage" }), "{path}");
        }
        let body = app.get(&format!("{prefix}/screen?query=Market%20Capitalization%20%3E%20500"), 200).await;
        assert_eq!(body["query"], "Market Capitalization > 500");
        assert_eq!(body["count"], 1);
        assert_eq!(body["data"][0]["Symbol"], "/company/ACME/");
        assert_eq!(body["data"][0]["Market Capitalization"], 1234.5);
    }
}
