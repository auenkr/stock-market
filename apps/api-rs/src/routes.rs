//! HTTP layer: middleware (request ID, CORS, auth gate) and route handlers.
//! Response envelopes, status codes and headers match the TypeScript adapter.

use crate::{
    auth::{extract_key, has_detailed_data, authorize, AccessDecision},
    catalog::*,
    config::Config,
    error::{legacy_code, legacy_error, DataError},
    legacy::*,
    provider::Provider,
};
use axum::{
    extract::{Query, State, Extension},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::get,
    Json,
};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: Option<Pool>,
    pub provider: Provider,
}

fn request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn no_store(mut response: Response, id: &str) -> Response {
    response.headers_mut().insert("x-request-id", HeaderValue::from_str(id).unwrap());
    response.headers_mut().insert("cache-control", HeaderValue::from_static("no-store"));
    response
}

fn auth_envelope(message: &str, status: u16, retry_after: Option<i64>) -> Response {
    let code = legacy_code(message);
    let status_code = StatusCode::from_u16(status).unwrap();
    let mut builder = Response::builder().status(status_code).header("cache-control", "no-store");
    if let Some(retry) = retry_after {
        builder = builder.header("retry-after", retry.to_string());
    }
    builder.body(axum::body::Body::from(serde_json::to_string(&json!({ "error": message, "code": code })).unwrap())).unwrap()
}

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

fn homepage(origin: &str, environment: &str) -> String {
    let internal = if environment == "dev" {
        r#"<h2>Internal: dividends and ownership</h2>
        <p><code>GET /v1/dividend?symbol=/company/RELIANCE/</code> · <code>GET /v1/shareholdings/ownership-current?symbol=/company/RELIANCE/</code></p>
        <h2>List upcoming IPOs</h2>
        <p><code>GET /api/list-of-ipo</code></p>
        <pre><code>curl ""#.to_string()
            + origin
            + r#""/v1/list-of-ipo"</code></pre>
        <h2>Get company data</h2>
        <p><code>GET /api/company-data?symbol=&lt;company-path&gt;</code></p>
        <pre><code>curl ""#
            + origin
            + r#""/v1/company-data?symbol=%2Fcompany%2Fid%2F1286218%2F"</code></pre>"#
    } else {
        String::new()
    };
    format!(
        r#"<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Stock Market API</title>
        <style>
          :root {{ color-scheme: dark; --bg: #0b1020; --panel: #121a2e; --text: #e8eefc; --muted: #9aa8c7; --accent: #72e0b8; }}
          body {{ background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; }}
          main {{ margin: 0 auto; max-width: 58rem; padding: 5rem 1.5rem; }}
          h1 {{ font-size: clamp(2.5rem, 7vw, 5rem); line-height: .95; letter-spacing: -.06em; max-width: 11ch; }}
          h2 {{ margin-top: 3rem; }}
          p {{ color: var(--muted); max-width: 46rem; }}
          code, pre {{ background: var(--panel); border: 1px solid #253152; border-radius: .5rem; }}
          code {{ padding: .15rem .35rem; color: var(--accent); }}
          pre {{ overflow-x: auto; padding: 1rem; color: var(--accent); }}
          a {{ color: var(--accent); }}
        </style>
      </head>
      <body><main>
        <p>MARKET DATA / API v1</p><h1>Build on better market data.</h1>
        <p>Independent Indian company fundamentals and ownership data. Explore <a href="/docs">the API reference</a> or download <a href="/swagger.json">swagger.json</a>. Source-backed adapters have partial coverage; market history is excluded.</p>
        <h2>Company fundamentals</h2>
        <pre><code>curl --get "{origin}/v1/profit-loss" --data-urlencode "symbol=/company/RELIANCE/consolidated/"</code></pre>
        {internal}
        <h2>Search companies</h2>
        <p><code>GET /api/company-search?q=&lt;company-name&gt;</code></p>
        <pre><code>curl "{origin}/v1/company-search?q=reli"</code></pre>
        <h2>List companies</h2>
        <p><code>GET /api/list-of-company?page=1</code></p>
        <pre><code>curl "{origin}/v1/list-of-company?page=1"</code></pre>
      </main></body>
    </html>"#
    )
}

const DOCS_HTML: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledgerline API reference</title><style>
body{margin:0;background:#f5f8f7;color:#0d1b2a;font:14px/1.7 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:40px 24px}h1{font-size:40px;letter-spacing:-2px;line-height:1.1}a{color:#376747}input{width:100%;padding:13px;box-sizing:border-box;border:1px solid #dce5e8;border-radius:8px;margin:18px 0}details{background:white;border:1px solid #dce5e8;border-radius:10px;margin:12px 0;padding:18px}summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}pre{background:#0d1b2a;color:#c9f36b;padding:16px;border-radius:8px;overflow:auto;font-size:12px}code{font-size:12px}p{color:#6f7f8c}.badge{font-size:11px;color:#4e7852;margin-right:12px}.parameter{border-bottom:1px solid #edf0ed;padding:8px 0}h2{font-size:18px;margin-top:24px}
</style></head><body><main><small>LEDGERLINE / API REFERENCE</small><h1>Explore the financial data contract.</h1><p id="intro">Loading Swagger…</p><a href="/swagger.json" download>Download swagger.json</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/v1/coverage">Coverage</a><input type="search" id="search" aria-label="Search endpoints" placeholder="Search endpoints, parameters or coverage…"><div id="operations"></div></main><script>
const container=document.querySelector('#operations');const search=document.querySelector('#search');
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
fetch('/swagger.json').then(r=>{if(!r.ok)throw Error('Swagger HTTP '+r.status);return r.json();}).then(spec=>{
 document.querySelector('#intro').textContent=spec.info.description;
 const entries=Object.entries(spec.paths).filter(([,p])=>p.get&&!p.get['x-alias']).map(([path,item])=>[path,item,Object.entries(spec.paths).filter(([,alias])=>alias.get?.['x-alias']&&alias.get['x-canonical-path']===path).map(([alias])=>alias)]);
 entries.sort((a,b)=>a[1].get['x-order']-b[1].get['x-order']);
 function render(){container.replaceChildren();for(const group of spec['x-user-journey']){const section=el('section');let count=0;for(const[path,item,aliases]of entries){const op=item.get;if(op['x-use-case']!==group.id||!(path+' '+aliases.join(' ')+' '+JSON.stringify(op)).toLowerCase().includes(search.value.toLowerCase()))continue;
  const card=el('details');const summary=el('summary');const badge=el('span','GET · '+op['x-tier']+' · '+(op['x-coverage']||'service'));badge.className='badge';summary.append(badge,document.createTextNode(path+' — '+op.summary));card.append(summary,el('p',op.description||''));
 if(aliases.length)card.append(el('p','Also available at '+aliases.join(', ')));
 if(op.parameters?.length){card.append(el('h2','Parameters'));for(const p of op.parameters){const row=el('div',p.name+' · '+p.in+' · '+(p.required?'required':'optional')+' — '+(p.description||''));row.className='parameter';card.append(row);}}
 for(const[status,response]of Object.entries(op.responses)){card.append(el('h2',status+' — '+response.description));const schema=response.content?.['application/json']?.schema;if(schema)card.append(el('pre',JSON.stringify(schema,null,2)));if(response.headers)for(const[name,header]of Object.entries(response.headers))card.append(el('p',name+' — '+(header.description||'')));}
  section.append(card);count++;
  }if(count){section.prepend(el('h2',group.order+'. '+group.title),el('p',group.description));container.append(section);}}if(!container.children.length)container.append(el('p','No matching endpoints.'));}render();search.addEventListener('input',render);const schemas=el('details');schemas.append(el('summary','All response models'),el('pre',JSON.stringify(spec.components.schemas,null,2)));container.after(schemas);
}).catch(error=>{document.querySelector('#intro').textContent='Could not load Swagger: '+error.message;});
</script></body></html>"#;

// ---------------------------------------------------------------------------
// Middleware: request ID + CORS + auth gate
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Authed {
    plan: String,
}

async fn gate(
    State(state): State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let id = request_id();
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let started = std::time::Instant::now();
    tracing::info!(event = "api.request.started", request_id = %id, method = %method, path = %path);

    let response = gate_request(State(state), req, next, id.clone()).await;
    let status = response.status().as_u16();
    tracing::info!(
        event = "api.request.completed",
        request_id = %id,
        method = %method,
        path = %path,
        status,
        elapsed_ms = started.elapsed().as_millis() as u64
    );
    if status >= 500 {
        tracing::warn!(event = "api.request.server_error", request_id = %id, method = %method, path = %path, status);
    }
    response
}

async fn gate_request(
    State(state): State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
    id: String,
) -> Response {
    let path = req.uri().path().to_string();
    if req.method() == Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header("x-request-id", &id)
            .header("access-control-allow-origin", "*")
            .header("access-control-allow-methods", "GET, POST, OPTIONS")
            .header("access-control-allow-headers", "Content-Type, Authorization, X-API-Key")
            .body(axum::body::Body::empty())
            .unwrap();
    }
    let guarded = ["/v1/", "/v2/", "/api/"].iter().any(|p| path.starts_with(p));
    let mut req = req;
    if guarded {
        let decision = authorize(extract_key(req.headers()), state.db.as_ref()).await;
        match decision {
            AccessDecision::Unauthorized => return with_id(auth_envelope("Invalid or expired API key", 401, None), &id),
            AccessDecision::Unavailable => return with_id(auth_envelope("Account usage service unavailable", 503, None), &id),
            AccessDecision::Limited { retry_after } => return with_id(auth_envelope("Rate limit exceeded", 429, Some(retry_after)), &id),
            AccessDecision::Allowed { plan } => {
                // Legacy paid gate mirrors the TypeScript middleware exactly.
                if !has_detailed_data(&plan) {
                    if let Some(resource) = path.strip_prefix("/v1/").or_else(|| path.strip_prefix("/api/")).map(|p| p.split('/').next().unwrap_or("")) {
                        if matches!(resource, "company-data" | "extract") {
                            let body = json!({ "error": "This endpoint requires Personal or Professional", "code": "PAID_PLAN_REQUIRED", "docs": "/v1/coverage" });
                            let response = (StatusCode::FORBIDDEN, Json(body)).into_response();
                            return no_store(response, &id);
                        }
                    }
                }
                req.extensions_mut().insert(Authed { plan });
            }
        }
    }
    let mut response = next.run(req).await;
    // CORS + request ID on every response; authorized routes are no-store.
    response.headers_mut().insert("x-request-id", HeaderValue::from_str(&id).unwrap());
    response.headers_mut().insert("access-control-allow-origin", HeaderValue::from_static("*"));
    response.headers_mut().insert("access-control-expose-headers", HeaderValue::from_static("X-Request-ID, X-Page, X-Next-Page, X-Data-Coverage, Retry-After"));
    if guarded {
        response.headers_mut().insert("cache-control", HeaderValue::from_static("no-store"));
    }
    response
}

fn with_id(response: Response, id: &str) -> Response {
    let mut response = response;
    response.headers_mut().insert("x-request-id", HeaderValue::from_str(id).unwrap());
    response.headers_mut().insert("access-control-allow-origin", HeaderValue::from_static("*"));
    response
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn root(State(state): State<AppState>, uri: Uri, headers: HeaderMap) -> Response {
    let origin = origin_of(&uri, &headers);
    (StatusCode::OK, Html(homepage(&origin, &state.config.environment))).into_response()
}

fn origin_of(uri: &Uri, headers: &HeaderMap) -> String {
    if let Some(host) = headers.get("x-forwarded-host").or_else(|| headers.get("host")).and_then(|v| v.to_str().ok()) {
        let scheme = headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()).unwrap_or("https");
        return format!("{scheme}://{host}");
    }
    format!("http://localhost:{}", uri.port_u16().unwrap_or(3000))
}

async fn health() -> Response {
    (StatusCode::OK, Json(json!({ "status": "ok", "service": "stock-market-api", "version": "1.2.0" }))).into_response()
}

async fn docs() -> Response {
    (StatusCode::OK, Html(DOCS_HTML)).into_response()
}

async fn spec(State(state): State<AppState>, uri: Uri, headers: HeaderMap) -> Response {
    let origin = origin_of(&uri, &headers);
    (StatusCode::OK, Json(crate::catalog::openapi_spec(&origin, &state.config.environment))).into_response()
}

async fn plugin_spec(State(state): State<AppState>, uri: Uri, headers: HeaderMap) -> Response {
    let origin = origin_of(&uri, &headers);
    let mut spec = crate::catalog::openapi_spec(&origin, &state.config.environment);
    if let Some(info) = spec.get_mut("info") {
        *info = json!({ "title": "Ledgerline Stock Market API for AI agents", "version": "1.2.0",
            "description": "Indian company financials for AI agents. Discovery-first: search or list companies, then pass the returned symbol to company endpoints. No internal or market-history endpoints are exposed." });
    }
    (StatusCode::OK, Json(spec)).into_response()
}

async fn plugin_manifest(State(state): State<AppState>, uri: Uri, headers: HeaderMap) -> Response {
    let origin = origin_of(&uri, &headers);
    let _ = state;
    (StatusCode::OK, Json(json!({
        "schema_version": "v1",
        "name_for_human": "Ledgerline Stock Market",
        "name_for_model": "ledgerline_stock_market",
        "description_for_human": "Indian company financials.",
        "description_for_model": "Indian company financials for AI agents. Discovery-first: search or list companies, then pass the returned symbol to company endpoints.",
        "auth": { "type": "service_http", "authorization_type": "bearer" },
        "api": { "type": "openapi", "url": format!("{origin}/plugin/openapi.json") },
        "logo_url": format!("{origin}/logo.png"),
        "contact_email": "support@example.org",
        "legal_info_url": format!("{origin}/docs"),
    }))).into_response()
}

async fn coverage() -> Response {
    (StatusCode::OK, Json(coverage_document())).into_response()
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "Endpoint not found", "code": "NOT_FOUND" }))).into_response()
}

// --- compatibility dataset route ------------------------------------------

async fn compat_handler(
    State(state): State<AppState>,
    Extension(authed): Extension<Authed>,
    uri: Uri,
    Query(multi): Query<Vec<(String, String)>>,
) -> Response {
    let endpoint = uri.path().to_string();
    let catalog = endpoint_catalog();
    // Match /api/v1/... canonical path or /v1/... alias.
    let canonical = if endpoint.starts_with("/api/v") { endpoint.clone() } else { format!("/api{endpoint}") };
    let contract = catalog.iter().find(|c| c.path == canonical);
    let Some(contract) = contract else { return not_found().await };
    if contract.status == "excluded" {
        return not_found().await;
    }
    let params: HashMap<String, String> = multi.iter().cloned().collect();
    let symbol_count = multi.iter().filter(|(k, _)| k == "symbol").count();
    let query = match validate_query(contract, &params, &HashMap::new(), &multi) {
        Ok(q) => q,
        Err(e) => return e.into_compat_response(contract.path),
    };
    let plan = authed.plan;
    if !has_detailed_data(&plan) && contract.tier == "paid" {
        return DataError::new("This endpoint requires Personal or Professional", 403, "PAID_PLAN_REQUIRED").into_compat_response(contract.path);
    }
    if let Some(symbol) = query.get("symbol") {
        if !crate::parse::valid_company_path(symbol) || symbol_count != 1 {
            return DataError::new("symbol must be a single company URL path", 400, "INVALID_QUERY").into_compat_response(contract.path);
        }
        if let Err(e) = require_company_access(&plan, &[symbol.clone()]) {
            return e.into_compat_response(contract.path);
        }
    }
    match state.provider.execute(contract.resource, &query).await {
        Ok(result) => {
            let mut builder = Response::builder().status(StatusCode::OK);
            for (name, value) in &result.headers {
                let lower = name.to_lowercase();
                // Hono's c.header replaces; axum's builder appends, so skip the
                // coverage header here and set it exactly once below.
                if lower == "x-data-source" || lower == "x-data-coverage" {
                    continue;
                }
                builder = builder.header(lower, value.as_str());
            }
            builder = builder.header("x-data-coverage", "partial");
            builder.body(axum::body::Body::from(serde_json::to_string(&result.body).unwrap())).unwrap()
        }
        Err(e) => {
            tracing::warn!(
                event = "api.endpoint.failed",
                endpoint = %contract.path,
                resource = %contract.resource,
                status = e.status,
                code = %e.code,
                message = %e.message
            );
            e.into_compat_response(contract.path)
        }
    }
}

async fn screen_handler(
    State(state): State<AppState>,
    Extension(authed): Extension<Authed>,
    Query(multi): Query<Vec<(String, String)>>,
) -> Response {
    const ENDPOINT: &str = "/api/v1/screen";
    let query_count = multi.iter().filter(|(name, _)| name == "query").count();
    if query_count != 1 || multi.iter().any(|(name, _)| name != "query") {
        return DataError::new("Only one query parameter is accepted", 400, "INVALID_QUERY").into_compat_response(ENDPOINT);
    }
    let expression = multi.iter().find(|(name, _)| name == "query").map(|(_, value)| value.as_str()).unwrap_or("");
    if expression.trim().is_empty() || expression.encode_utf16().count() > 4000 {
        return DataError::new("query must be a non-empty string of at most 4000 characters", 400, "INVALID_QUERY").into_compat_response(ENDPOINT);
    }
    if !has_detailed_data(&authed.plan) {
        return DataError::new("This endpoint requires Personal or Professional", 403, "PAID_PLAN_REQUIRED").into_compat_response(ENDPOINT);
    }
    let query = [("query".to_string(), expression.trim().to_string())].into_iter().collect();
    match state.provider.execute("screen", &query).await {
        Ok(result) => {
            let mut builder = Response::builder().status(StatusCode::OK);
            for (name, value) in &result.headers {
                if name.eq_ignore_ascii_case("x-data-coverage") || name.eq_ignore_ascii_case("x-data-source") {
                    continue;
                }
                builder = builder.header(name.to_lowercase(), value.as_str());
            }
            builder = builder.header("x-data-coverage", "partial");
            builder.body(axum::body::Body::from(serde_json::to_string(&result.body).unwrap())).unwrap()
        }
        Err(error) => error.into_compat_response(ENDPOINT),
    }
}

// --- legacy routes ----------------------------------------------------------

fn raw_pairs(multi: &[(String, String)]) -> Vec<(String, String)> {
    multi.to_vec()
}

async fn legacy_list(State(state): State<AppState>, Query(multi): Query<Vec<(String, String)>>) -> Response {
    let page_param = multi.iter().find(|(k, _)| k == "page").map(|(_, v)| v.clone()).unwrap_or_else(|| "1".to_string());
    // Mirrors Number(pageParam): safe integer >= 1.
    let page: i64 = match page_param.trim().parse::<f64>() {
        Ok(p) if p.is_finite() && p.fract() == 0.0 && p >= 1.0 && p <= 9_007_199_254_740_991.0 => p as i64,
        _ => return legacy_error("page must be a positive integer", 400).into_legacy_response(),
    };
    match get_company_list_page(COMPANY_PAGE_SIZE, page, &state.provider.source).await {
        Ok(list) => {
            let companies: Vec<Value> = list
                .companies
                .into_iter()
                .map(|mut c| {
                    if let Value::Object(ref mut map) = c {
                        let url = map.remove("url").unwrap_or(Value::Null);
                        let skip = map.remove("skip");
                        let _ = skip;
                        map.insert("symbol".to_string(), url);
                    }
                    c
                })
                .collect();
            let count = companies.len();
            let body = json!({
                "meta": { "currentPage": page, "limit": COMPANY_PAGE_SIZE, "count": count,
                    "isNextPageAvailable": list.next_page.is_some(), "nextPage": list.next_page,
                    "previousPage": if page > 1 { Some(page - 1) } else { None } },
                "data": companies,
            });
            (StatusCode::OK, Json(body)).into_response()
        }
        Err(e) => {
            tracing::warn!(event = "api.endpoint.failed", endpoint = "/v1/extract", status = e.status, code = %e.code, message = %e.message);
            e.into_legacy_response()
        }
    }
}

async fn legacy_search(State(state): State<AppState>, Query(multi): Query<Vec<(String, String)>>) -> Response {
    let q = multi.iter().find(|(k, _)| k == "q").map(|(_, v)| v.trim().to_string()).filter(|s| !s.is_empty());
    let Some(q) = q else { return legacy_error("q parameter is required", 400).into_legacy_response() };
    match company_search(&q, &state.provider.source).await {
        Ok(results) => (StatusCode::OK, Json(json!({ "data": results, "results": results }))).into_response(),
        Err(e) => e.into_legacy_response(),
    }
}

async fn legacy_ipos(State(state): State<AppState>) -> Response {
    match list_upcoming_ipos(&state.provider.source).await {
        Ok(rows) => (StatusCode::OK, Json(json!({ "data": rows, "ipos": rows }))).into_response(),
        Err(e) => e.into_legacy_response(),
    }
}

async fn legacy_company_data(State(state): State<AppState>, Query(multi): Query<Vec<(String, String)>>) -> Response {
    let pairs = raw_pairs(&multi);
    if !pairs.iter().any(|(k, v)| k == "symbol" && !v.trim().is_empty()) {
        return legacy_error("symbol parameter is required", 400).into_legacy_response();
    }
    let symbol = match check_symbol_param(&pairs, &[]) {
        Ok(s) => s,
        Err(e) => return e.into_legacy_response(),
    };
    match get_cached_company_data(&state.provider, &symbol).await {
        Ok(cached) => {
            let mut builder = Response::builder().status(StatusCode::OK);
            if cached.hit {
                builder = builder.header("x-cache", "HIT");
            }
            let mut data = cached.value.clone();
            if let Value::Object(ref mut map) = data {
                let url = map.remove("url").unwrap_or(Value::Null);
                map.insert("symbol".to_string(), Value::String(symbol.clone()));
                map.insert("website".to_string(), url);
            }
            builder.body(axum::body::Body::from(serde_json::to_string(&json!({ "data": data, "companyData": data })).unwrap())).unwrap()
        }
        Err(e) => e.into_legacy_response(),
    }
}

async fn legacy_extract(State(state): State<AppState>, Query(multi): Query<Vec<(String, String)>>) -> Response {
    let pairs = raw_pairs(&multi);
    if !pairs.iter().any(|(k, v)| k == "symbol" && !v.trim().is_empty()) {
        return legacy_error("symbol parameter is required", 400).into_legacy_response();
    }
    let symbol = match check_symbol_param(&pairs, &["symbol", "type"]) {
        Ok(s) => s,
        Err(e) => return e.into_legacy_response(),
    };
    let kind = multi.iter().find(|(k, _)| k == "type").map(|(_, v)| v.as_str()).unwrap_or("");
    if !["quarterly", "profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding", "peers"].contains(&kind) {
        return legacy_error("type must be one of: quarterly, profit-loss, balance-sheet, cash-flow, ratios, shareholding, peers", 400).into_legacy_response();
    }
    match extract_statement(&state.provider, &symbol, kind).await {
        Ok((data, hit)) => {
            let mut builder = Response::builder().status(StatusCode::OK);
            if hit {
                builder = builder.header("x-cache", "HIT");
            }
            let body = json!({ "data": data, "meta": { "symbol": symbol, "type": kind, "cached": hit } });
            builder.body(axum::body::Body::from(serde_json::to_string(&body).unwrap())).unwrap()
        }
        Err(e) => e.into_legacy_response(),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(state: AppState) -> axum::Router {
    let mut app = axum::Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/docs", get(docs))
        .route("/openapi.json", get(spec))
        .route("/swagger.json", get(spec))
        .route("/plugin/openapi.json", get(plugin_spec))
        .route("/.well-known/ai-plugin.json", get(plugin_manifest))
        .route("/v1/coverage", get(coverage))
        .route("/v1/list-of-company", get(legacy_list))
        .route("/api/list-of-company", get(legacy_list))
        .route("/v1/list-of-ipo", get(legacy_ipos))
        .route("/api/list-of-ipo", get(legacy_ipos))
        .route("/v1/company-search", get(legacy_search))
        .route("/api/company-search", get(legacy_search))
        .route("/v1/company-data", get(legacy_company_data))
        .route("/api/company-data", get(legacy_company_data))
        .route("/v1/extract", get(legacy_extract))
        .route("/api/extract", get(legacy_extract))
        .route("/api/v1/screen", get(screen_handler))
        .route("/v1/screen", get(screen_handler));
    // Compatibility datasets + personal aliases, excluding removed resources.
    for contract in endpoint_catalog().iter().filter(|c| c.status != "excluded") {
        if contract.resource == "screen" {
            continue;
        }
        app = app.route(contract.path, get(compat_handler));
        if let Some(alias) = contract.path.strip_prefix("/api") {
            app = app.route(alias, get(compat_handler));
        }
    }
    app.fallback(not_found)
        .method_not_allowed_fallback(not_found)
        .with_state(state.clone())
        .layer(axum::middleware::from_fn_with_state(state, gate))
}
