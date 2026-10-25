//! Legacy /v1 + /api adapters: company listing, search, IPO calendar,
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
// Search + IPO
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

fn parse_nullable_number(raw: &str) -> Option<f64> {
    let cleaned: String = raw.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
    if cleaned.is_empty() || cleaned == "-" || cleaned == "." {
        return None;
    }
    cleaned.parse::<f64>().ok().filter(|n| n.is_finite())
}

fn parse_subscription_times(raw: &str) -> Option<f64> {
    let lower = raw.to_lowercase();
    let num: String = lower.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let mut value = num.parse::<f64>().ok()?;
    if lower.contains("cr") {
        value *= 10_000_000.0;
    } else if lower.contains("lakh") || (lower.contains('l') && !lower.contains("total")) {
        value *= 100_000.0;
    } else if lower.contains('k') {
        value *= 1_000.0;
    }
    Some(value)
}

fn parse_ipo_date(raw: &str) -> Option<String> {
    // "12 Jan 2025" or "Jan 12, 2025".
    let cleaned = raw.replace(',', "");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() != 3 {
        return None;
    }
    let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let month = |m: &str| months.iter().position(|x| *x == m.get(..3).unwrap_or("").to_lowercase().as_str()).map(|i| i as u32 + 1);
    let (y, m, d): (i32, u32, u32) = if parts[2].len() == 4 {
        if parts[0].len() == 4 {
            return None;
        }
        // "12 Jan 2025"
        (parts[2].parse().ok()?, month(parts[1])?, parts[0].parse().ok()?)
    } else {
        return None;
    };
    chrono::NaiveDate::from_ymd_opt(y, m, d).map(|dt| dt.format("%Y-%m-%d").to_string())
}

fn parse_price_band(raw: &str) -> Value {
    let nums: Vec<f64> = raw
        .replace(',', "")
        .split(|c: char| !c.is_ascii_digit() && c != '.')
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<f64>().ok())
        .collect();
    let lower = nums.first().copied();
    let upper = nums.get(1).copied().or(lower);
    let fixed = raw.to_lowercase().contains("fixed") || lower == upper;
    json!({ "lower_band": lower, "upper_band": upper, "is_fixed_price": fixed })
}

fn parse_subscription_period(raw: &str) -> Value {
    // "12 Jan 2025 - 14 Jan 2025" or single date or "-".
    let parts: Vec<&str> = raw.split('-').map(str::trim).collect();
    if parts.len() >= 2 {
        json!({ "start_date": parse_ipo_date(parts[0]), "end_date": parse_ipo_date(parts[1]) })
    } else if parts.len() == 1 && !parts[0].is_empty() && parts[0] != "-" {
        let d = parse_ipo_date(parts[0]);
        json!({ "start_date": d.clone(), "end_date": d })
    } else {
        json!({ "start_date": Value::Null, "end_date": Value::Null })
    }
}

pub fn parse_upcoming_ipos(html: &str) -> Vec<Value> {
    let doc = Html::parse_document(html);
    let row_sel = Selector::parse("table.data-table > tbody > tr").unwrap();
    let td_sel = Selector::parse("td").unwrap();
    let company_link = Selector::parse("a[href^='/company/']").unwrap();
    let mut results = vec![];
    for tr in doc.select(&row_sel) {
        let cols: Vec<_> = tr.select(&td_sel).collect();
        if cols.len() < 8 {
            continue;
        }
        let name_cell = cols[0];
        let link = name_cell.select(&company_link).next();
        let name = link.map(|a| a.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or_default();
        let url = link.and_then(|a| a.value().attr("href")).unwrap_or("");
        let id = url.split("/company/id/").nth(1).and_then(|s| s.split('/').next()).filter(|s| !s.is_empty());
        let (Some(id), true) = (id, !url.is_empty() && !name.is_empty()) else { continue };
        let cell = |i: usize| cols.get(i).map(|c| c.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
        let mut exchanges = vec![];
        for a in name_cell.select(&Selector::parse("a").unwrap()) {
            let href = a.value().attr("href").unwrap_or("");
            if href.contains("nseindia.com") || href.contains("bseindia.com") {
                let label = a.select(&Selector::parse("span").unwrap()).next().map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or_else(|| a.text().collect::<Vec<_>>().join(" ").trim().to_string());
                if !label.is_empty() && !href.is_empty() {
                    exchanges.push(json!({ "exchange": label, "url": href }));
                }
            }
        }
        let sub_text = cols[5].select(&Selector::parse("button").unwrap()).next().map(|b| b.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or_default();
        results.push(json!({
            "id": id,
            "name": name,
            "url": url,
            "exchanges": exchanges,
            "subscription_period": parse_subscription_period(&cell(1)),
            "price": parse_price_band(&cell(2)),
            "listing_date": if cell(3).is_empty() || cell(3) == "-" { Value::Null } else { parse_ipo_date(&cell(3)).map(Value::String).unwrap_or(Value::Null) },
            "market_cap_cr": parse_nullable_number(&cell(4)).unwrap_or(0.0),
            "subscription": { "total_times": parse_subscription_times(&sub_text), "breakdown": Value::Null },
            "pe": parse_nullable_number(&cell(6)).unwrap_or(0.0),
            "roce_percentage": parse_nullable_number(&cell(7)).unwrap_or(0.0),
            "gmp_percentage": Value::Null,
        }));
    }
    results
}

fn has_complete_ipo(v: &Value) -> bool {
    v.get("subscription").and_then(|s| s.get("total_times")).and_then(|t| t.as_f64()).is_some()
        && v.get("market_cap_cr").and_then(|m| m.as_f64()).is_some()
}

pub async fn list_upcoming_ipos(source: &Source) -> Result<Vec<Value>, DataError> {
    let first = source.get_text("/ipo", false).await?.text;
    // Html is not Send; extract what we need and drop it before any await.
    let pages: Vec<i64> = {
        let doc = Html::parse_document(&first);
        let page_sel = Selector::parse(".pagination > .flex-baseline.options > a").unwrap();
        let mut pages: Vec<i64> = vec![];
        for a in doc.select(&page_sel) {
            let t = a.text().collect::<Vec<_>>().join(" ").trim().to_string();
            if let Ok(n) = t.parse::<i64>() {
                if n > 1 && !pages.contains(&n) {
                    pages.push(n);
                }
            }
        }
        pages
    };
    let first_results = parse_upcoming_ipos(&first);
    let mut results: Vec<Value> = first_results.iter().filter(|v| has_complete_ipo(v)).cloned().collect();
    if results.len() != first_results.len() {
        return Ok(enrich_gmp(with_symbols(results), source).await);
    }
    for page in pages {
        let html = source.get_text(&format!("/ipo?page={page}"), false).await?.text;
        let parsed = parse_upcoming_ipos(&html);
        let complete: Vec<Value> = parsed.iter().filter(|v| has_complete_ipo(v)).cloned().collect();
        let complete_len = complete.len();
        results.extend(complete);
        if complete_len != parsed.len() {
            break;
        }
    }
    Ok(enrich_gmp(with_symbols(results), source).await)
}

/// Best-effort GMP enrichment; failures leave gmp_percentage null like the TS adapter.
async fn enrich_gmp(rows: Vec<Value>, source: &Source) -> Vec<Value> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)).build();
    let Ok(client) = client else { return rows };
    let url = url::Url::parse("https://webnodejs.investorgain.com/cloud/v2/index/gmp-data").unwrap();
    let records: Vec<(String, f64)> = async {
        let key = source.cache_key("source", &url);
        let fetched = match &source.cache {
            Some(cache) => cache.remember(&key, 5 * 60, || async {
                let text = client.get(url.clone()).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
                Ok(Value::String(text))
            }, None).await.map(|h| h.value.as_str().unwrap_or("").to_string()).unwrap_or_default(),
            None => client.get(url.clone()).send().await.ok()?.text().await.ok()?,
        };
        let data: Value = serde_json::from_str(&fetched).ok()?;
        data.get("gmpList")?.as_array().map(|list| {
            list.iter()
                .filter_map(|r| {
                    let name = r.get("company_short_name")?.as_str()?.to_string();
                    let perc = r.get("gmp_perc")?.as_str().and_then(|s| s.parse::<f64>().ok())?;
                    if name.is_empty() || !perc.is_finite() { None } else { Some((name, perc)) }
                })
                .collect()
        })
    }
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|mut r| {
            let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
            if let Value::Object(ref mut map) = r {
                map.insert("gmp_percentage".to_string(), gmp_percentage(&name, &records).map(|v| json!(v)).unwrap_or(Value::Null));
            }
            r
        })
        .collect()
}

fn normalize_name(name: &str) -> String {
    name.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn gmp_percentage(name: &str, records: &[(String, f64)]) -> Option<f64> {
    let target = normalize_name(name);
    if let Some((_, perc)) = records.iter().find(|(n, _)| normalize_name(n) == target) {
        return Some(*perc);
    }
    let tokens: Vec<&str> = name.split_whitespace().collect();
    let mut best: Option<(usize, f64)> = None;
    for (short, perc) in records {
        let short_norm = normalize_name(short);
        let score: usize = tokens.iter().map(|t| { let n = normalize_name(t); if !n.is_empty() && short_norm.contains(&n) { n.len().min(10) } else { 0 } }).sum();
        if score > 0 && best.map(|(s, _)| score > s).unwrap_or(true) {
            best = Some((score, *perc));
        }
    }
    best.map(|(_, p)| p)
}

fn with_symbols(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|mut r| {
            if let Value::Object(ref mut map) = r {
                if let Some(url) = map.get("url").cloned() {
                    map.insert("symbol".to_string(), url);
                }
            }
            r
        })
        .collect()
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
