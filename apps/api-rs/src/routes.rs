//! HTTP layer: middleware (request ID and CORS) and route handlers.
//! Response envelopes, status codes and headers match the TypeScript adapter.

use crate::{
    catalog::*,
    config::Config,
    error::{legacy_error, DataError},
    legacy::*,
    provider::Provider,
};
use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{Html, IntoResponse, Redirect, Response},
    routing::get,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub provider: Provider,
    pub ipo: crate::ipo::Ipo,
}

fn request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

const CLIENT_QUICKSTART: &str = r##"
<section id="mcp">
  <h2>Connect with MCP</h2>
  <p>Add this URL to your MCP client's remote server settings. Use Streamable HTTP with no authentication.</p>
  <pre><code>https://stock-market-mcp.auenkr.com/mcp</code></pre>
  <p>All 14 tools are read-only. Search for a company, then use its returned symbol to request financial data. Use <code>screen_companies</code> to find companies by financial criteria.</p>
  <p>To run the HTTP adapter on your own computer:</p>
  <pre><code>npx @auenkr/legerline-mcp --port 8788</code></pre>
  <p>Connect your client to <code>http://127.0.0.1:8788/mcp</code>. The adapter calls the deployed Rust API.</p>
</section>
<section id="cli">
  <h2>Use the CLI</h2>
  <pre><code>npx @auenkr/legerline-cli get_v1_company_search --q reliance
npx @auenkr/legerline-cli get_api_v1_profit_loss --symbol /company/RELIANCE/consolidated/
npx @auenkr/legerline-cli get_api_v1_screen --query "Market Capitalization &gt; 500 AND Price to Earning &lt; 15"</code></pre>
  <p>Run <code>npx @auenkr/legerline-cli tools</code> to list commands. Add <code>--help</code> to any command for its parameters.</p>
  <p>Both clients use <a href="https://stock-market-api.auenkr.com">https://stock-market-api.auenkr.com</a> by default. Override it with <code>--api-url</code> when using another server.</p>
  <p><a href="https://www.npmjs.com/package/@auenkr/legerline-cli">CLI on npm</a> · <a href="https://www.npmjs.com/package/@auenkr/legerline-mcp">MCP on npm</a> · <a href="#screening">Screening guide</a></p>
</section>
"##;

fn homepage(origin: &str, environment: &str) -> String {
    let internal_note = if environment == "dev" { "Dev mode: internal endpoints are listed below." } else { "" };
    format!(
        r##"<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Ledgerline — free stock market data</title>
        <style>
          :root {{ color-scheme: dark; --bg: #0b1020; --panel: #121a2e; --text: #e8eefc; --muted: #9aa8c7; --accent: #72e0b8; }}
          body {{ background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; }}
          main {{ margin: 0 auto; max-width: 58rem; padding: 5rem 1.5rem; }}
          h1 {{ font-size: clamp(2.5rem, 7vw, 5rem); line-height: .95; letter-spacing: -.06em; max-width: 11ch; }}
          h2 {{ margin-top: 3rem; }}
          p {{ color: var(--muted); max-width: 46rem; }}
          code, pre {{ background: var(--panel); border: 1px solid #253152; border-radius: .5rem; }}
          code {{ padding: .15rem .35rem; color: var(--accent); }}
          pre {{ max-width: 100%; overflow-x: auto; padding: 1rem; color: var(--accent); }}
          a {{ color: var(--accent); overflow-wrap: anywhere; }}
          section {{ scroll-margin-top: 1.5rem; }}
          pre code {{ border: 0; padding: 0; }}
          input {{ width: 100%; box-sizing: border-box; padding: 1rem; background: var(--panel); color: var(--text); border: 1px solid #253152; border-radius: .5rem; }}
          details {{ background: var(--panel); border: 1px solid #253152; border-radius: .5rem; margin: 1rem 0; padding: 1rem; }}
          summary {{ cursor: pointer; font-weight: 600; overflow-wrap: anywhere; }}
          .badge {{ color: var(--accent); font-size: .75rem; margin-right: .75rem; }}
          .parameter {{ border-bottom: 1px solid #253152; padding: .5rem 0; overflow-wrap: anywhere; }}
          li {{ color: var(--muted); margin: .5rem 0; }}
          #screening code {{ overflow-wrap: anywhere; }}
          nav ol li {{ color: var(--text); }}
          .op {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }}
          @media (max-width: 52rem) {{ .op {{ grid-template-columns: 1fr; }} }}
          .live {{ border-left: 1px solid #253152; padding-left: 1rem; min-width: 0; }}
          .live pre {{ max-height: 24rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }}
        </style>
      </head>
      <body><main>
        <p>LEDGERLINE / INDIAN COMPANY FINANCIALS</p><h1>Free market data for your next idea.</h1>
        <p>No login, API key, subscription, or payment required.</p>
        <nav aria-label="Contents"><ol><li><a href="#mcp">Connect with MCP</a></li><li><a href="#cli">Use the CLI</a></li><li><a href="#call-the-api">Call the API</a></li><li><a href="#screening">Screening guide</a></li><li><a href="#api-reference">API reference</a></li></ol></nav>
        <p>Independent Indian company fundamentals and ownership data. Explore <a href="#api-reference">the API reference</a> or download <a href="/swagger.json">swagger.json</a>. Source-backed adapters have partial coverage; market history is excluded.</p>
        {CLIENT_QUICKSTART}
        <section id="call-the-api"><h2>Call the API</h2>
        <pre><code>curl --get "{origin}/v1/profit-loss" --data-urlencode "symbol=/company/RELIANCE/consolidated/"</code></pre></section>
        <section id="ipo-api"><h2>IPO data</h2>
        <p>Browse Mainboard and SME IPOs and retrieve company details, grey market premium (GMP), subscription history, and reviews. IPO data is scraped from IPO Guru, cached, and reused on subsequent requests.</p>
        <h3>List IPOs</h3><p><code>type</code> is required; use <code>mainboard</code> or <code>sme</code>. The optional one-based <code>page</code> selects older listings.</p>
        <pre><code>curl "{origin}/v1/ipos?type=mainboard"
curl "{origin}/v1/ipos?type=sme&amp;page=2"</code></pre>
        <p>Each listing includes an <code>id</code> used to fetch its detail pages, along with the name, status, open and close dates, price band, lot size, issue size, GMP, and subscription multiple.</p>
        <h3>IPO detail endpoints</h3><ul>
          <li><code>GET /v1/ipo?id=&lt;id&gt;</code> — issue summary, timetable, news, financials, valuation, strengths and risks, objects, anchors, documents, and FAQ.</li>
          <li><code>GET /v1/ipo-gmp?id=&lt;id&gt;</code> — GMP chart and history, expected listing, timetable, Kostak and Sauda, and FAQ.</li>
          <li><code>GET /v1/ipo-subscription?id=&lt;id&gt;</code> — live bidding, allotment odds, day-wise history, anchors, insights, and FAQ.</li>
          <li><code>GET /v1/ipo-review?id=&lt;id&gt;</code> — verdict and score, detailed and analyst reviews, and FAQ.</li>
        </ul><p>For example, append <code>?id=eaaa-india-alternatives-ipo</code> to any detail endpoint. The same endpoints are available under <code>/api/v1/</code>. Responses are cached for reuse; listings for 10 minutes, GMP and subscription for 5 minutes, and detail and review for 30 minutes.</p></section>
        <p>{internal_note}</p>
        <section id="screening">{SCREENING_GUIDE}</section>
        {API_REFERENCE}
        <footer><p><a href="/privacy-policy">Privacy Policy</a> · <a href="/terms-of-service">Terms of Service</a> · <a href="/support">Support</a></p></footer>
      </main></body>
    </html>"##
    )
}

const API_REFERENCE: &str = r##"<section id="api-reference"><h2>API reference</h2><p id="intro">Loading API reference…</p><p><a href="/swagger.json" download>Download swagger.json</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/v1/coverage">Coverage data</a></p>
<details><summary>What does “partial” mean?</summary><p><strong>partial</strong> means the endpoint is backed by a public source adapter that returns a subset of the fields a full market-data vendor would. Returned values are real, but some fields (for example share counts, voting rights or pledges) can be <code>null</code> or missing, and some pages or companies may be unavailable. Every such response carries the header <code>X-Data-Coverage: partial</code>. Endpoints marked <em>service</em> or <em>legacy</em> are not coverage-limited.</p></details>
<input type="search" id="search" aria-label="Search endpoints" placeholder="Search endpoints, parameters or coverage…"><div id="operations"></div></section><script>
const container=document.querySelector('#operations');const search=document.querySelector('#search');
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
// Live example: called once, the first time an endpoint is opened.
async function runLive(path,op,pane){
 const query=new URLSearchParams();let url=path;
 for(const p of op.parameters||[]){const v=p.example??p.schema?.example;if(v===undefined)continue;if(p.in==='path')url=url.replace('{'+p.name+'}',encodeURIComponent(v));else if(p.required||p.name==='symbol'||p.name==='page')query.set(p.name,v);}
 const full=url+(query.toString()?'?'+query:'');
 pane.replaceChildren(el('h3','Request'),el('pre','GET '+full+'\n\ncurl "'+location.origin+full+'"'),el('h3','Response'),el('p','Calling…'));
 try{const started=performance.now();const res=await fetch(full);const text=await res.text();let shown=text;try{shown=JSON.stringify(JSON.parse(text),null,2);}catch{}
  const headers=['x-request-id','x-data-coverage','x-page','x-next-page'].filter(h=>res.headers.get(h)).map(h=>h+': '+res.headers.get(h)).join('\n');
   pane.lastChild.replaceWith(el('p','HTTP '+res.status+' · '+Math.round(performance.now()-started)+' ms'),el('pre',(headers?headers+'\n\n':'')+shown));
 }catch(error){pane.lastChild.replaceWith(el('p','Request failed: '+error.message));}}
fetch('/swagger.json').then(r=>{if(!r.ok)throw Error('Swagger HTTP '+r.status);return r.json();}).then(spec=>{
 document.querySelector('#intro').textContent=spec.info.description;
 const entries=Object.entries(spec.paths).filter(([,p])=>p.get&&!p.get['x-alias']).map(([path,item])=>[path,item,Object.entries(spec.paths).filter(([,alias])=>alias.get?.['x-alias']&&alias.get['x-canonical-path']===path).map(([alias])=>alias)]);
 entries.sort((a,b)=>a[1].get['x-order']-b[1].get['x-order']);
 function render(){container.replaceChildren();for(const group of spec['x-user-journey']){const section=el('section');let count=0;for(const[path,item,aliases]of entries){const op=item.get;if(op['x-use-case']!==group.id||!(path+' '+aliases.join(' ')+' '+JSON.stringify(op)).toLowerCase().includes(search.value.toLowerCase()))continue;
  const card=el('details');card.name='api-endpoint';const summary=el('summary');const badge=el('span','GET · '+op['x-tier']+' · '+(op['x-coverage']||'service'));badge.className='badge';summary.append(badge,document.createTextNode(path+' — '+op.summary));
  const body=el('div');body.className='op';const doc=el('div');const live=el('div');live.className='live';body.append(doc,live);card.append(summary,body);
  doc.append(el('p',op.description||''));
  if(aliases.length)doc.append(el('p','Also available at '+aliases.join(', ')));
  if(op.parameters?.length){doc.append(el('h3','Parameters'));for(const p of op.parameters){const row=el('div',p.name+' · '+p.in+' · '+(p.required?'required':'optional')+' — '+(p.description||''));row.className='parameter';doc.append(row);}}
  for(const[status,response]of Object.entries(op.responses)){doc.append(el('h3',status+' — '+response.description));const schema=response.content?.['application/json']?.schema;if(schema)doc.append(el('pre',JSON.stringify(schema,null,2)));if(response.headers)for(const[name,header]of Object.entries(response.headers))doc.append(el('p',name+' — '+(header.description||'')));}
   let called=false;card.addEventListener('toggle',()=>{if(!card.open)return;for(const other of container.querySelectorAll('details[open]'))if(other!==card)other.open=false;if(!called){called=true;runLive(path,op,live);}});
  section.append(card);count++;
  }if(count){section.prepend(el('h2',group.order+'. '+group.title),el('p',group.description));container.append(section);}}if(!container.children.length)container.append(el('p','No matching endpoints.'));}render();search.addEventListener('input',render);const schemas=el('details');schemas.append(el('summary','All response models'),el('pre',JSON.stringify(spec.components.schemas,null,2)));container.after(schemas);
}).catch(error=>{document.querySelector('#intro').textContent='Could not load Swagger: '+error.message;});
</script>"##;

const SCREENING_GUIDE: &str = include_str!("pages/screening.html");

// ---------------------------------------------------------------------------
// Middleware: request ID + CORS
// ---------------------------------------------------------------------------

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
    State(_state): State<AppState>,
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
    let mut response = next.run(req).await;
    // CORS + request ID on every response; data routes are no-store.
    response.headers_mut().insert("x-request-id", HeaderValue::from_str(&id).unwrap());
    response.headers_mut().insert("access-control-allow-origin", HeaderValue::from_static("*"));
    response.headers_mut().insert("access-control-expose-headers", HeaderValue::from_static("X-Request-ID, X-Page, X-Next-Page, X-Data-Coverage, Retry-After"));
    if guarded {
        response.headers_mut().insert("cache-control", HeaderValue::from_static("no-store"));
    }
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

fn information_page(title: &str, content: &str) -> Html<String> {
    Html(format!(r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{title} | Ledgerline</title><style>
body {{ margin:0; background:#0b1020; color:#e8eefc; font:16px/1.7 system-ui,sans-serif; }}
main {{ max-width:58rem; margin:auto; padding:3rem 1.5rem; }}
a {{ color:#72e0b8; overflow-wrap:anywhere; }} p {{ color:#9aa8c7; }} h2 {{ margin-top:2rem; }}
nav {{ display:flex; flex-wrap:wrap; gap:1rem; }} h1 {{ line-height:1.15; }}
</style></head><body><main><nav aria-label="Site navigation"><a href="/">Home and docs</a><a href="/privacy-policy">Privacy Policy</a><a href="/terms-of-service">Terms of Service</a><a href="/support">Support</a></nav><h1>{title}</h1>{content}</main></body></html>"#))
}

async fn privacy_policy() -> Html<String> {
    information_page("Privacy Policy", include_str!("pages/privacy-policy.html"))
}

async fn terms_of_service() -> Html<String> {
    information_page("Terms of Service", include_str!("pages/terms-of-service.html"))
}

async fn support() -> Html<String> {
    information_page("Support", include_str!("pages/support.html"))
}

async fn docs() -> Response {
    Redirect::permanent("/#api-reference").into_response()
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
        "auth": { "type": "none" },
        "api": { "type": "openapi", "url": format!("{origin}/plugin/openapi.json") },
        "logo_url": format!("{origin}/logo.png"),
        "contact_email": "support@example.org",
        "legal_info_url": format!("{origin}/terms-of-service"),
    }))).into_response()
}

async fn coverage() -> Response {
    (StatusCode::OK, Json(coverage_document())).into_response()
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "Endpoint not found", "code": "NOT_FOUND" }))).into_response()
}

// --- compatibility dataset route ------------------------------------------

async fn ipo_handler(State(state): State<AppState>, uri: Uri, Query(params): Query<HashMap<String, String>>) -> Response {
    use crate::ipo::Page;
    let endpoint = uri.path().replacen("/api", "", 1);
    let result = match endpoint.as_str() {
        "/v1/ipos" => {
            let page = params.get("page").map(|p| p.parse::<u32>()).transpose();
            match (params.get("type"), page) {
                (Some(kind), Ok(page)) => state.ipo.list(kind, page.unwrap_or(1).max(1)).await,
                (None, _) => Err(DataError::new("type is required: mainboard or sme", 400, "INVALID_QUERY")),
                (_, Err(_)) => Err(DataError::new("page must be a positive integer", 400, "INVALID_QUERY")),
            }
        }
        other => {
            let page = match other {
                "/v1/ipo" => Page::Detail,
                "/v1/ipo-gmp" => Page::Gmp,
                "/v1/ipo-subscription" => Page::Subscription,
                _ => Page::Review,
            };
            match params.get("id") {
                Some(id) => state.ipo.page(page, id).await,
                None => Err(DataError::new("id is required", 400, "INVALID_QUERY")),
            }
        }
    };
    match result {
        Ok(body) => (StatusCode::OK, Json(body)).into_response(),
        Err(e) => e.into_compat_response(&uri.path().to_string()),
    }
}

async fn compat_handler(
    State(state): State<AppState>,
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
    if let Some(symbol) = query.get("symbol") {
        if !crate::parse::valid_company_path(symbol) || symbol_count != 1 {
            return DataError::new("symbol must be a single company URL path", 400, "INVALID_QUERY").into_compat_response(contract.path);
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
        .route("/privacy-policy", get(privacy_policy))
        .route("/terms-of-service", get(terms_of_service))
        .route("/support", get(support))
        .route("/openapi.json", get(spec))
        .route("/swagger.json", get(spec))
        .route("/plugin/openapi.json", get(plugin_spec))
        .route("/.well-known/ai-plugin.json", get(plugin_manifest))
        .route("/v1/coverage", get(coverage))
        .route("/v1/list-of-company", get(legacy_list))
        .route("/api/list-of-company", get(legacy_list))
        .route("/v1/company-search", get(legacy_search))
        .route("/api/company-search", get(legacy_search))
        .route("/v1/company-data", get(legacy_company_data))
        .route("/api/company-data", get(legacy_company_data))
        .route("/v1/extract", get(legacy_extract))
        .route("/api/extract", get(legacy_extract))
        .route("/api/v1/screen", get(screen_handler))
        .route("/v1/screen", get(screen_handler));
    for (path, _) in crate::catalog::IPO_ROUTES {
        app = app.route(path, get(ipo_handler)).route(&path.replace("/api/v1", "/v1"), get(ipo_handler));
    }
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

#[cfg(test)]
mod public_endpoint_tests;

#[cfg(test)]
mod public_tests {
    use super::*;

    #[tokio::test]
    async fn anonymous_routes_validate_input_without_account_database() {
        let config = Config::from_env();
        let fixture_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let fixture_address = fixture_listener.local_addr().unwrap();
        let fixture = axum::Router::new().route("/mainboard-ipos", get(|| async { Html(r#"<h2 id="current-h">x</h2><table class="lt"><tbody><tr><td class="lt-ipo"><a href="https://x/ipo/acme-ipo" class="lt-name">Acme IPO</a></td></tr></tbody></table>"#) }))
            .route("/api/company/search/", get(|| async {
            Json(json!([{ "name": "Reliance", "url": "/company/RELIANCE/consolidated/" }]))
        }));
        let fixture_server = tokio::spawn(async move { axum::serve(fixture_listener, fixture).await.unwrap() });
        let source = crate::source::Source::new(format!("http://{fixture_address}"), None, None, 0);
        let ipo = crate::ipo::Ipo::new(format!("http://{fixture_address}"), None);
        let state = AppState { config, provider: Provider::new(source), ipo };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
        let client = reqwest::Client::new();
        for path in ["/api/v1/screen", "/api/v1/profit-loss", "/api/v1/company-profile?symbol=invalid"] {
            let response = client.get(format!("http://{address}{path}")).send().await.unwrap();
            assert_eq!(response.status().as_u16(), 400, "{path} should reach validation without auth");
            assert!(response.headers().contains_key("x-request-id"));
            assert_eq!(response.headers()["access-control-allow-origin"], "*");
        }
        let spec: Value = client.get(format!("http://{address}/openapi.json")).send().await.unwrap().json().await.unwrap();
        assert_eq!(spec["security"], json!([]));
        assert_eq!(spec["components"]["securitySchemes"], json!({}));
        let coverage: Value = client.get(format!("http://{address}/v1/coverage")).send().await.unwrap().json().await.unwrap();
        assert_eq!(coverage["accessPolicy"]["authenticationRequired"], false);
        assert!(coverage["endpoints"].as_array().unwrap().iter().all(|e| e["tier"] == "free"));
        let search: Value = client.get(format!("http://{address}/v1/company-search?q=reliance")).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        assert_eq!(search["data"][0]["symbol"], "/company/RELIANCE/consolidated/");
        // IPO endpoints: validated, scraped from the fixture, documented in the spec.
        for path in ["/v1/ipos", "/v1/ipos?type=bonds", "/api/v1/ipo", "/v1/ipo-gmp?id=../x", "/v1/ipo-review?id=BAD", "/v1/ipos?type=sme&page=x"] {
            let response = client.get(format!("http://{address}{path}")).send().await.unwrap();
            assert_eq!(response.status().as_u16(), 400, "{path}");
            assert_eq!(response.json::<Value>().await.unwrap()["code"], "INVALID_QUERY");
        }
        let ipo_list: Value = client.get(format!("http://{address}/api/v1/ipos?type=mainboard")).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        assert_eq!(ipo_list["items"][0]["id"], "acme-ipo");
        let spec_paths = spec["paths"].as_object().unwrap();
        for path in ["/api/v1/ipos", "/v1/ipos", "/api/v1/ipo", "/v1/ipo-gmp", "/v1/ipo-subscription", "/v1/ipo-review"] {
            assert_eq!(spec_paths[path]["get"]["x-use-case"], "ipo", "{path}");
        }
        assert!(spec["x-user-journey"].as_array().unwrap().iter().any(|g| g["id"] == "internal"));
        server.abort();
        fixture_server.abort();
    }
}
