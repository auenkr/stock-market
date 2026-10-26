//! Legacy /v1 + /api adapters: company listing and search,
//! cached company payloads and statement extraction.

use crate::{
    cache::COMPANY_CACHE_TTL,
    company::get_company_data,
    error::{decode_error, encode_error, legacy_error, DataError},
    parse::*,
    provider::Provider,
    source::Source,
};
use scraper::{Html, Selector};
use serde_json::{json, Value};

pub const COMPANY_PAGE_SIZE: i64 = 100;

// ---------------------------------------------------------------------------
// Company listing
// ---------------------------------------------------------------------------

pub struct ListPage {
    pub companies: Vec<Value>,
    pub next_page: Option<i64>,
}

pub async fn get_company_list_page(limit: i64, page: i64, source: &Source) -> Result<ListPage, DataError> {
    let url = format!("/screens/357649/all-listed-companies/?limit={limit}&page={page}");
    let text = source.get_text(&url, false).await?.text;
    let doc = Html::parse_document(&text);
    let row_sel = Selector::parse("table.data-table tr[data-row-company-id], table.data-table tbody tr").unwrap();
    let td_sel = Selector::parse("td").unwrap();
    let a_sel = Selector::parse("a").unwrap();
    let mut companies = vec![];
    for tr in doc.select(&row_sel) {
        let columns: Vec<_> = tr.select(&td_sel).collect();
        if columns.len() < 11 {
            continue;
        }
        let cell = |i: usize| columns.get(i).map(|c| c.text().collect::<Vec<_>>().join(" ")).unwrap_or_default();
        let link = columns.get(1).and_then(|c| c.select(&a_sel).next());
        companies.push(json!({
            "name": link.map(|a| a.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or_default(),
            "url": link.and_then(|a| a.value().attr("href")).unwrap_or(""),
            "cmp": safe_parse_float(&cell(2)),
            "pe": safe_parse_float(&cell(3)),
            "marketCap": safe_parse_float(&cell(4)),
            "divYld": safe_parse_float(&cell(5)),
            "npQtr": safe_parse_float(&cell(6)),
            "qtrProfitVar": safe_parse_float(&cell(7)),
            "salesQtr": safe_parse_float(&cell(8)),
            "qtrSalesVar": safe_parse_float(&cell(9)),
            "roce": safe_parse_float(&cell(10)),
            "skip": false,
        }));
    }
    if companies.is_empty() {
        let title = doc.select(&Selector::parse("title").unwrap()).next().map(|t| t.text().collect::<Vec<_>>().join(" ").to_lowercase()).unwrap_or_default();
        let login_form = doc.select(&Selector::parse("form[action*='login']").unwrap()).next().is_some();
        if title.contains("login") || title.contains("register") || login_form {
            return Err(DataError::new("Screener returned a login page. Configure valid SOURCE_USERNAME and SOURCE_PASSWORD.", 502, "UPSTREAM_UNAVAILABLE"));
        }
        return Err(DataError::new("Screener returned no company rows.", 502, "UPSTREAM_UNAVAILABLE"));
    }
    Ok(ListPage { companies, next_page: next_page(&text, page) })
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

pub async fn company_search(query: &str, source: &Source) -> Result<Vec<Value>, DataError> {
    let text = source.get_text(&format!("/api/company/search/?q={}", urlencoding(query)), false).await?.text;
    let rows: Vec<Value> = serde_json::from_str(&text).map_err(|_| DataError::new("Source search format changed", 502, "UPSTREAM_SCHEMA_CHANGED"))?;
    Ok(rows
        .into_iter()
        .map(|mut r| {
            if let Value::Object(ref mut map) = r {
                if let Some(url) = map.remove("url") {
                    map.insert("symbol".to_string(), url);
                }
            }
            r
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Cached company payload + extract
// ---------------------------------------------------------------------------

pub struct CachedCompany {
    pub value: Value,
    pub hit: bool,
}

pub async fn get_cached_company_data(provider: &Provider, endpoint: &str) -> Result<CachedCompany, DataError> {
    let source = &provider.source;
    let normalized = if endpoint.ends_with('/') { endpoint.to_string() } else { format!("{endpoint}/") };
    let url = source.url(&normalized)?;
    let key = source.cache_key("legacy-company", &url);
    let load = || async {
        let data = get_company_data(provider, endpoint).await.map_err(|e| encode_error(&e))?;
        serde_json::to_value(&data.value).map_err(|e| e.to_string())
    };
    match &source.cache {
        Some(cache) => {
            let hit = cache.remember(&key, COMPANY_CACHE_TTL, load, None).await.map_err(|m| decode_error(&m))?;
            Ok(CachedCompany { value: hit.value, hit: hit.hit })
        }
        None => Ok(CachedCompany { value: load().await.map_err(|m| decode_error(&m))?, hit: false }),
    }
}

pub async fn extract_statement(provider: &Provider, symbol: &str, kind: &str) -> Result<(Vec<Value>, bool), DataError> {
    let cached = get_cached_company_data(provider, symbol).await?;
    let data = match kind {
        "quarterly" => cached.value.get("quarterlyResultStatements"),
        "profit-loss" => cached.value.get("profitAndLossStatements"),
        "balance-sheet" => cached.value.get("balanceSheetStatements"),
        "cash-flow" => cached.value.get("cashFlowStatements"),
        "ratios" => cached.value.get("ratioStatements"),
        "shareholding" => cached.value.get("shareholdingPatternStatements"),
        "peers" => cached.value.get("peerCompanies"),
        _ => None,
    };
    let arr = data.and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok((arr, cached.hit))
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Strict legacy symbol check: exactly one symbol key, valid company path.
pub fn check_symbol_param(all: &[(String, String)], allowed_extra: &[&str]) -> Result<String, DataError> {
    let symbols: Vec<&str> = all.iter().filter(|(k, _)| k == "symbol").map(|(_, v)| v.as_str()).collect();
    if symbols.len() != 1 {
        return Err(legacy_error("symbol must be a single company path", 400));
    }
    for (k, _) in all {
        if k != "symbol" && !allowed_extra.contains(&k.as_str()) {
            return Err(legacy_error("symbol must be a single company path", 400));
        }
    }
    let symbol = symbols[0].trim().to_string();
    if !valid_company_path(&symbol) {
        return Err(legacy_error("symbol must be a single company path", 400));
    }
    Ok(symbol)
}
