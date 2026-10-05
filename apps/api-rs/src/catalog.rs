//! Endpoint catalogue, query validation, coverage document and OpenAPI spec.
//! Values (tiers, parameters, limitations, journey order) mirror the TypeScript
//! adapters so the contract suite passes unchanged.

use crate::error::DataError;
use serde_json::{json, Value};
use std::collections::HashMap;

pub const FREE_COMPANIES: &[&str] = &["RELIANCE", "HDFCBANK", "BHARTIARTL", "ICICIBANK", "SBIN"];
pub const FREE_COMPANIES_AS_OF: &str = "2026-10-01";
pub const INSPECTED_AT: &str = "2026-10-03";

#[derive(Debug, Clone)]
pub struct Parameter {
    pub name: &'static str,
    pub location: &'static str,
    pub required: bool,
    pub schema_type: Option<&'static str>,
    pub values: Option<&'static [&'static str]>,
    pub format_date: bool,
}

#[derive(Debug, Clone)]
pub struct Contract {
    pub path: &'static str,
    pub title: &'static str,
    pub tier: &'static str,
    pub resource: &'static str,
    pub status: &'static str,
    pub limitation: &'static str,
    pub parameters: Vec<Parameter>,
}

fn param(name: &'static str, values: Option<&'static [&'static str]>, required: bool) -> Parameter {
    Parameter { name, location: "query", required, schema_type: Some("string"), values, format_date: false }
}
fn symbol_param() -> Parameter {
    param("symbol", None, true)
}
fn period_param() -> Parameter {
    param("period", Some(&["annual", "quarterly"]), true)
}
fn date_param(name: &'static str, required: bool) -> Parameter {
    Parameter { name, location: "query", required, schema_type: Some("string"), values: None, format_date: true }
}
fn company(resource: &'static str, title: &'static str, tier: &'static str) -> Contract {
    Contract {
        path: Box::leak(format!("/api/v1/{resource}").into_boxed_str()),
        title,
        tier,
        resource,
        status: "partial",
        limitation: limitation_for(resource),
        parameters: vec![symbol_param()],
    }
}
fn endpoint(resource: &'static str, title: &'static str, parameters: Vec<Parameter>, status: &'static str, path: Option<&'static str>, tier: &'static str) -> Contract {
    let default_path = format!("/api/v1/{resource}");
    Contract {
        path: path.unwrap_or(Box::leak(default_path.into_boxed_str())),
        title,
        tier,
        resource,
        status,
        limitation: if status == "excluded" { "Market history is excluded from this project." } else { limitation_for(resource) },
        parameters,
    }
}

fn limitation_for(resource: &str) -> &'static str {
    match resource {
        "company-profile" => "Company description, website, exchange identifiers, classification, and market capitalization in INR crores. Missing values are null.",
        "quarterly-profit-loss" => "Quarterly profit and loss. Amounts are INR rupees; EPS is INR per share. Pass the URL-valued symbol unchanged.",
        "profit-loss" => "Annual profit and loss and available TTM results, including EBIT, EBITDA, operating profit, revenue, and tax fraction. Amounts are INR rupees; EPS is INR per share.",
        "balance-sheet" => "Annual balance sheets and available detailed schedules. Amounts are INR rupees. Missing fields are null.",
        "cash-flow" => "Annual operating, investing, and financing cash flows in INR rupees.",
        "ratios" => "Profitability ratios as fractions (0.25 means 25%), plus the reported historical ratio table. Only symbol is accepted.",
        "basic-financials" => "Summary, business description, key points, current price data, and pros/cons analysis. Prices may be delayed. Market capitalization is INR crores; unavailable shares, trade time, and volume are null.",
        "company-documents" => "Company documents grouped into annual reports, announcements, credit ratings, call transcripts, presentations, and other links. Exact dates may be null; missing document groups are empty arrays.",
        "peer-comparison" => "Company comparison rows including URL-valued symbols, price, P/E, market capitalization, dividend yield, quarterly sales and profit, growth, and ROCE. Monetary comparison figures are INR crores except price (INR per share); percentages are percentage points.",
        "shareholding-pattern" => "Quarterly ownership percentages for categories and disclosed holders. Missing percentages are null. This is not a complete shareholder register. Only symbol is accepted.",
        "shareholdings/summary" => "Reporting period, total shareholder count, and promoter percentage where available. Share counts, voting rights, pledges, and warrants may be null.",
        "shareholdings/distribution" => "Quarterly ownership categories and percentages by reporting period. Only URL-valued symbol is accepted. Category-specific counts, voting rights, and share totals may be null.",
        "shareholdings/ownership-current" => "Disclosed holder names, categories, and percentages for the latest available quarter. Does not include every shareholder; additional filing fields may be null.",
        "shareholdings/ownership-history" => "Disclosed holder names, categories, and percentages across available annual or quarterly periods. Missing periods are omitted; additional filing fields may be null.",
        "corporate-actions" => "Company corporate actions using a URL-valued symbol. Optional action=split, bonus, rights, or dividend filters the result; omit action for all actions. Returns a stable actions array. Dates use YYYY-MM-DD; historical adjustment factors are unavailable. Follow X-Next-Page for rights; non-rights records appear only on page 1.",
        "corporate-actions/all" => "Paginated market corporate-action records. Optional action filters split, bonus, rights, or dividend; omit it for all. Optional URL-valued symbol selects a single company, including its rights records. Market-wide dividend amounts may be null. Date filters apply to the requested page; follow X-Next-Page.",
        "dividend" => "Dividend dates, INR per share, type, and description. Dates use YYYY-MM-DD; historically adjusted amounts are unavailable.",
        "results-calendar" => "Upcoming results within a YYYY-MM-DD date window. Filters apply to each requested page. Dates indicate expected publication dates. Past calendars are unavailable.",
        _ => "The connected source does not supply this dataset.",
    }
}

pub fn endpoint_catalog() -> Vec<Contract> {
    let mut catalog = vec![
        company("company-profile", "Company profile", "free"),
        company("basic-financials", "Basic finance", "free"),
        company("company-documents", "Company documents", "paid"),
        company("peer-comparison", "Peer comparison", "free"),
        company("quarterly-profit-loss", "Quarterly profit and loss", "paid"),
        company("profit-loss", "Profit and loss", "paid"),
        company("balance-sheet", "Balance sheet", "paid"),
        company("cash-flow", "Cash flow", "paid"),
        company("ratios", "Ratios", "paid"),
        company("shareholding-pattern", "Shareholding pattern", "paid"),
        company("shareholdings/distribution", "Shareholding distribution", "paid"),
        endpoint("daily-price-ratios", "Price ratios daily", vec![symbol_param()], "excluded", None, "paid"),
        endpoint("annual-price-ratios", "Price ratios annual", vec![symbol_param()], "excluded", None, "paid"),
        endpoint("shareholdings/summary", "Ownership structure", vec![symbol_param(), period_param()], "partial", None, "paid"),
        endpoint("shareholdings/ownership-current", "Current owners", vec![symbol_param()], "partial", None, "paid"),
        endpoint("shareholdings/ownership-history", "Owner history", vec![symbol_param(), period_param()], "partial", None, "paid"),
        endpoint("corporate-actions/all", "Market corporate actions",
            vec![Parameter { name: "symbol", location: "query", required: false, schema_type: Some("string"), values: None, format_date: false },
                 Parameter { name: "action", location: "query", required: false, schema_type: Some("string"), values: Some(&["split", "bonus", "rights", "dividend"]), format_date: false },
                 date_param("from_date", false), date_param("to_date", false)], "partial", None, "paid"),
        endpoint("corporate-actions", "Company corporate actions",
            vec![symbol_param(), Parameter { name: "action", location: "query", required: false, schema_type: Some("string"), values: Some(&["split", "bonus", "rights", "dividend"]), format_date: false }], "partial", None, "paid"),
        company("dividend", "Dividends", "paid"),
        endpoint("results-calendar", "Results calendar", vec![date_param("from_date", true), date_param("to_date", true)], "partial", None, "free"),
        endpoint("index/market-price/historical", "Index historical market price",
            vec![param("index_symbol", None, true), date_param("from_date", true), date_param("to_date", true)], "excluded", None, "paid"),
        endpoint("index/valuation/historical", "Index valuation",
            vec![param("index_symbol", None, true), date_param("from_date", true), date_param("to_date", true)], "excluded", None, "paid"),
        endpoint("commodity-price", "Commodity price trend",
            vec![Parameter { name: "code", location: "path", required: true, schema_type: Some("integer"), values: None, format_date: false }], "excluded", Some("/api/v1/commodity-price/{code}"), "paid"),
    ];
    catalog.sort_by_key(|c| endpoint_order(c.path));
    catalog
}

pub const PAGED_RESOURCES: &[&str] = &["results-calendar", "corporate-actions/all", "corporate-actions"];

pub fn journey() -> Vec<(&'static str, &'static str, &'static str, Vec<&'static str>)> {
    vec![
        ("company-search", "Search", "Search by company name or browse the paginated company list. Both return the original company URL path as symbol.", vec!["/v1/company-search", "/v1/list-of-company"]),
        ("company-overview", "Company overview", "Company profile, basic finance, business description, analysis, and documents.", vec!["/api/v1/company-profile", "/api/v1/basic-financials", "/api/v1/company-documents"]),
        ("finance", "Finance", "Peer comparison, quarterly and annual profit and loss, balance sheet, cash flow, ratios, shareholding pattern and distribution. Only symbol is required; its URL selects standalone or consolidated data.", vec!["/api/v1/peer-comparison", "/api/v1/quarterly-profit-loss", "/api/v1/profit-loss", "/api/v1/balance-sheet", "/api/v1/cash-flow", "/api/v1/ratios", "/api/v1/shareholding-pattern", "/api/v1/shareholdings/distribution"]),
        ("internal", "Internal", "Supplementary ownership, corporate actions, results calendar, upcoming IPOs, full-company extraction, and service endpoints. Documented only in dev mode.", vec![
            "/api/v1/daily-price-ratios", "/api/v1/annual-price-ratios",
            "/api/v1/shareholdings/summary", "/api/v1/shareholdings/ownership-current", "/api/v1/shareholdings/ownership-history",
            "/api/v1/corporate-actions", "/api/v1/dividend", "/api/v1/corporate-actions/all",
            "/api/v1/results-calendar", "/v1/list-of-ipo",
            "/api/v1/index/market-price/historical", "/api/v1/index/valuation/historical", "/api/v1/commodity-price/{code}",
            "/v1/company-data", "/v1/extract", "/health", "/v1/coverage",
        ]),
    ]
}

pub fn endpoint_use_case(path: &str) -> &'static str {
    for (id, _, _, paths) in journey() {
        if paths.contains(&path) {
            return id;
        }
    }
    panic!("Endpoint has no user-journey classification: {path}");
}

pub fn endpoint_order(path: &str) -> usize {
    let ordered: Vec<&str> = journey().into_iter().flat_map(|g| g.3).collect();
    ordered.iter().position(|p| *p == path).map(|i| i + 1).unwrap_or_else(|| panic!("Endpoint has no user-journey classification: {path}"))
}

// ---------------------------------------------------------------------------
// Query validation — identical messages to the TypeScript adapter.
// ---------------------------------------------------------------------------

pub fn validate_query(contract: &Contract, params: &HashMap<String, String>, path_params: &HashMap<String, String>, raw_query: &[(String, String)]) -> Result<HashMap<String, String>, DataError> {
    let mut query = params.clone();
    for (k, v) in path_params {
        query.insert(k.clone(), v.clone());
    }
    for parameter in &contract.parameters {
        let value = query.get(parameter.name).map(|v| v.trim().to_string());
        if let Some(v) = &value {
            query.insert(parameter.name.to_string(), v.clone());
        }
        if parameter.required && value.as_ref().map(|v| v.is_empty()).unwrap_or(true) {
            return Err(DataError::new(format!("{} parameter is required", parameter.name), 400, "INVALID_QUERY"));
        }
        let Some(value) = value.filter(|v| !v.is_empty()) else { continue };
        if let Some(values) = parameter.values {
            if !values.contains(&value.as_str()) {
                return Err(DataError::new(format!("{} must be one of: {}", parameter.name, values.join(", ")), 400, "INVALID_QUERY"));
            }
        }
        if parameter.schema_type == Some("integer") && !value.bytes().all(|b| b.is_ascii_digit()) {
            return Err(DataError::new(format!("{} must be an integer", parameter.name), 400, "INVALID_QUERY"));
        }
        if parameter.format_date && !crate::parse::valid_date(&value) {
            return Err(DataError::new(format!("{} must be a valid YYYY-MM-DD date", parameter.name), 400, "INVALID_QUERY"));
        }
        let _ = parameter.location;
    }
    if let Some(page) = query.get("page") {
        if !page.bytes().all(|b| b.is_ascii_digit()) || page.parse::<i64>().map(|p| p < 1).unwrap_or(true) {
            return Err(DataError::new("page must be a positive integer", 400, "INVALID_QUERY"));
        }
    }
    match (query.get("from_date"), query.get("to_date")) {
        (Some(from), Some(to)) if from > to => return Err(DataError::new("from_date must not be after to_date", 400, "INVALID_QUERY")),
        _ => {}
    }
    let paged = PAGED_RESOURCES.contains(&contract.resource);
    let mut allowed: Vec<&str> = contract.parameters.iter().map(|p| p.name).collect();
    if paged {
        allowed.push("page");
    }
    for (name, _) in raw_query {
        if !allowed.contains(&name.as_str()) {
            return Err(DataError::new(format!("Unknown query parameter: {name}"), 400, "INVALID_QUERY"));
        }
    }
    Ok(query)
}

pub fn require_company_access(plan: &str, symbols: &[String]) -> Result<(), DataError> {
    if plan == "free"
        && symbols.iter().any(|symbol| {
            !FREE_COMPANIES.iter().any(|allowed| {
                symbol == *allowed
                    || symbol.trim_end_matches('/').to_uppercase() == format!("/COMPANY/{allowed}")
                    || symbol.trim_end_matches('/').to_uppercase() == format!("/COMPANY/{allowed}/CONSOLIDATED")
            })
        })
    {
        return Err(DataError::new(
            format!("Free company endpoints are limited to {}. Upgrade to access other companies.", FREE_COMPANIES.join(", ")),
            403,
            "FREE_COMPANY_RESTRICTED",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Coverage document
// ---------------------------------------------------------------------------

pub fn coverage_document() -> Value {
    let catalog = endpoint_catalog();
    json!({
        "inspectedAt": INSPECTED_AT,
        "accessPolicy": {
            "freeCompanies": FREE_COMPANIES,
            "rankedBy": "market-capitalization",
            "asOf": FREE_COMPANIES_AS_OF,
            "requestsPerMinute": { "free": 10, "basic": 60, "personal": 300, "professional": 500 },
            "plans": {
                "free": { "name": "Hobby", "monthlyPrice": 0, "requestsPerMinute": 10, "commercial": false },
                "basic": { "name": "Basic", "monthlyPrice": 199, "requestsPerMinute": 60, "commercial": false },
                "personal": { "name": "Personal", "monthlyPrice": 399, "requestsPerMinute": 300, "commercial": false },
                "professional": { "name": "Professional", "monthlyPrice": 2499, "requestsPerMinute": 500, "commercial": true },
            },
        },
        "userJourney": journey().iter().enumerate().map(|(i, (id, title, description, _))| {
            json!({ "id": id, "title": title, "description": description, "order": i + 1 })
        }).collect::<Vec<_>>(),
        "endpoints": catalog.iter().map(|c| {
            json!({
                "path": c.path, "title": c.title, "tier": c.tier, "apiStyle": "personal",
                "resource": c.resource, "status": c.status, "limitation": c.limitation,
                "useCase": endpoint_use_case(c.path), "order": endpoint_order(c.path),
            })
        }).collect::<Vec<_>>(),
    })
}

// ---------------------------------------------------------------------------
// OpenAPI spec (openapi 3.0.3, apiKey security; internal group hidden outside dev)
// ---------------------------------------------------------------------------

fn parameter_note(name: &str) -> &'static str {
    match name {
        "symbol" => "Company URL path returned as symbol by search, company listing, or IPO listing. Pass unchanged. The URL selects standalone or consolidated data. Exchange tickers, absolute URLs, arrays and repeated symbols are not accepted.",
        "period" => "Reporting frequency: annual or quarterly.",
        "action" => "Optional corporate-action filter: split, bonus, rights, or dividend. Omit to return all corporate actions.",
        "page" => "One-based source page. Continue with X-Next-Page until empty; filters are applied within each page.",
        "from_date" => "Inclusive lower date bound, YYYY-MM-DD.",
        "to_date" => "Inclusive upper date bound, YYYY-MM-DD; must be on or after from_date.",
        _ => "Reference parameter.",
    }
}

fn example_for(name: &str) -> Value {
    match name {
        "symbol" => json!("/company/RELIANCE/consolidated/"),
        "period" => json!("quarterly"),
        "action" => json!("bonus"),
        "page" => json!(1),
        "code" => json!(123),
        "from_date" => json!("2026-10-01"),
        "to_date" => json!("2026-10-31"),
        _ => Value::Null,
    }
}

pub fn openapi_spec(origin: &str, environment: &str) -> Value {
    let mut paths = serde_json::Map::new();
    for contract in endpoint_catalog().iter().filter(|c| c.status != "excluded") {
        let mut aliases = vec![contract.path.to_string()];
        if let Some(rest) = contract.path.strip_prefix("/api/v") {
            aliases.push(format!("/v{rest}"));
        }
        let mut parameters: Vec<Value> = contract
            .parameters
            .iter()
            .map(|p| {
                let mut schema = serde_json::Map::new();
                schema.insert("type".to_string(), json!(p.schema_type.unwrap_or("string")));
                if let Some(values) = p.values {
                    schema.insert("enum".to_string(), json!(values));
                }
                json!({ "name": p.name, "in": p.location, "required": p.required, "description": parameter_note(p.name), "schema": schema, "example": example_for(p.name) })
            })
            .collect();
        if PAGED_RESOURCES.contains(&contract.resource) {
            parameters.push(json!({ "name": "page", "in": "query", "required": false, "description": parameter_note("page"),
                "schema": { "type": "integer", "minimum": 1 }, "example": 1 }));
        }
        let schema_ref = format!("#/components/schemas/{}", contract.resource.replace(['-', '/'], "_"));
        for path in &aliases {
            let operation = path.replace(|c: char| !c.is_alphanumeric(), "_").trim_matches('_').to_string();
            paths.insert(path.clone(), json!({ "get": {
                "operationId": format!("get_{operation}"),
                "summary": contract.title,
                "tags": [journey_title(endpoint_use_case(contract.path))],
                "description": contract.limitation,
                "parameters": parameters,
                "x-tier": contract.tier, "x-api-style": "personal", "x-coverage": contract.status,
                "x-resource": contract.resource, "x-canonical-path": contract.path, "x-alias": *path != contract.path,
                "x-use-case": endpoint_use_case(contract.path), "x-order": endpoint_order(contract.path),
                "responses": {
                    "200": { "description": "Source-backed subset.", "headers": {
                        "X-Request-ID": { "description": "Request identifier.", "schema": { "type": "string", "format": "uuid" } },
                        "X-Data-Coverage": { "description": "Current adapters expose partial coverage.", "schema": { "type": "string", "enum": ["partial"] } },
                        "X-Page": { "description": "Requested source page.", "schema": { "type": "integer" } },
                        "X-Next-Page": { "description": "Next source page.", "schema": { "type": "string" } } },
                        "content": { "application/json": { "schema": { "$ref": schema_ref } } } },
                    "400": error_response("Invalid, missing or unknown parameter"),
                    "401": error_response("Missing, invalid, expired or revoked API key"),
                    "403": error_response("Personal or Professional required for detailed data, or company outside the Hobby top-five allowlist"),
                    "404": error_response("Source resource not found"),
                    "429": { "description": "Request allowance exceeded.", "headers": { "Retry-After": { "schema": { "type": "integer" } } }, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                    "501": error_response("Dataset or requested variation is unavailable"),
                    "502": error_response("Data could not be retrieved"),
                    "503": error_response("Service temporarily unavailable; retry later"),
                },
            }}));
        }
    }
    for path in ["/v1/list-of-company", "/v1/list-of-ipo", "/v1/company-search", "/v1/company-data", "/v1/extract"] {
        for route in [path.to_string(), path.replace("/v1", "/api")] {
            let operation = route.replace(|c: char| !c.is_alphanumeric(), "_").trim_matches('_').to_string();
            paths.insert(route.clone(), json!({ "get": {
                "operationId": format!("get_{operation}"),
                "summary": route,
                "tags": ["Internal"],
                "x-tier": "legacy", "x-api-style": "legacy", "x-coverage": "legacy",
                "x-canonical-path": path, "x-alias": route != path,
                "x-use-case": "internal", "x-order": endpoint_order(path),
                "responses": { "200": { "description": "Legacy envelope." } },
            }}));
        }
    }
    paths.insert("/health".to_string(), json!({ "get": {
        "operationId": "get_health", "tags": ["free"], "x-tier": "free", "x-api-style": "service",
        "summary": "Service health", "security": [], "x-coverage": "service",
        "x-use-case": "internal", "x-order": endpoint_order("/health"),
        "responses": { "200": { "description": "Process availability.", "content": { "application/json": { "schema": { "type": "object" } } } } } } }));
    paths.insert("/v1/coverage".to_string(), json!({ "get": {
        "operationId": "get_coverage", "tags": ["free"], "x-tier": "free", "x-api-style": "service",
        "summary": "Endpoint coverage and limitations", "x-coverage": "service",
        "x-use-case": "internal", "x-order": endpoint_order("/v1/coverage"),
        "responses": { "200": { "description": "Reference inventory." } } } }));
    let mut spec = json!({
        "openapi": "3.0.3",
        "info": { "title": "Ledgerline Stock Market API", "version": "1.2.0", "description": "Indian company financials, ownership, corporate actions, and market information." },
        "security": [{ "apiKey": [] }],
        "servers": [{ "url": origin }],
        "tags": journey().iter().map(|(_, title, description, _)| json!({ "name": title, "description": description })).collect::<Vec<_>>(),
        "x-user-journey": journey().iter().enumerate().map(|(i, (id, title, description, _))| json!({ "id": id, "title": title, "description": description, "order": i + 1 })).collect::<Vec<_>>(),
        "components": { "securitySchemes": { "apiKey": { "type": "apiKey", "in": "header", "name": "X-API-Key" } },
            "schemas": { "Error": { "type": "object", "required": ["error", "code"], "properties": { "error": { "type": "string" }, "code": { "type": "string" } } } } },
        "paths": paths,
    });
    if environment != "dev" {
        // Internal documentation is opt-in: hide the internal group outside dev.
        if let Some(paths) = spec.get_mut("paths").and_then(|p| p.as_object_mut()) {
            paths.retain(|_, entry| entry.get("get").and_then(|g| g.get("x-use-case")).and_then(|u| u.as_str()) != Some("internal"));
        }
    }
    spec
}

fn journey_title(id: &str) -> &'static str {
    for (gid, title, _, _) in journey() {
        if gid == id {
            return title;
        }
    }
    "Internal"
}

fn error_response(description: &str) -> Value {
    json!({ "description": description, "headers": { "X-Request-ID": { "description": "Request identifier.", "schema": { "type": "string" } } },
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } })
}
