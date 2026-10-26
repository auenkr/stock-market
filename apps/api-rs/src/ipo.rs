//! IPO data: scrape ipoguru.in once, cache the parsed JSON, keep reusing it.
//! Independent of the company-data adapters. Parsed documents are stored in
//! Valkey when configured, otherwise in a process-local TTL map.

use crate::{
    cache::{source_cache_key, SourceCache},
    error::{upstream_error, DataError},
};
use scraper::{ElementRef, Html, Selector};
use serde_json::{json, Map, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;

const LIST_TTL: i64 = 10 * 60;
const DETAIL_TTL: i64 = 30 * 60;
const LIVE_TTL: i64 = 5 * 60;
/// Bump when the parsed shape changes so stale cached documents are not reused.
const PARSER_VERSION: u32 = 7;

#[derive(Clone, Copy, PartialEq)]
pub enum Page {
    Detail,
    Gmp,
    Subscription,
    Review,
}

impl Page {
    fn prefix(self) -> &'static str {
        match self {
            Page::Detail => "ipo",
            Page::Gmp => "ipo-gmp",
            Page::Subscription => "ipo-subscription",
            Page::Review => "ipo-review",
        }
    }
    fn ttl(self) -> i64 {
        match self {
            Page::Detail | Page::Review => DETAIL_TTL,
            Page::Gmp | Page::Subscription => LIVE_TTL,
        }
    }
}

#[derive(Clone)]
pub struct Ipo {
    client: reqwest::Client,
    base_url: String,
    cache: Option<SourceCache>,
    local: Arc<Mutex<HashMap<String, (i64, Value)>>>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl Ipo {
    pub fn new(base_url: String, cache: Option<SourceCache>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36")
            .build()
            .expect("reqwest client");
        Self { client, base_url, cache, local: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub async fn list(&self, kind: &str, page: u32) -> Result<Value, DataError> {
        let (path, label) = match kind {
            "mainboard" => ("/mainboard-ipos", "mainboard"),
            "sme" => ("/sme-ipos", "sme"),
            _ => return Err(DataError::new("type must be mainboard or sme", 400, "INVALID_QUERY")),
        };
        let path = if page > 1 { format!("{path}?page={page}") } else { path.to_string() };
        let label = label.to_string();
        self.cached(&path, LIST_TTL, move |html| parse_list(html, &label, page)).await
    }

    pub async fn page(&self, page: Page, id: &str) -> Result<Value, DataError> {
        if !valid_id(id) {
            return Err(DataError::new("id must be an IPO slug such as eaaa-india-alternatives-ipo", 400, "INVALID_QUERY"));
        }
        let path = format!("/{}/{id}", page.prefix());
        let id = id.to_string();
        self.cached(&path, page.ttl(), move |html| parse_page(html, page, &id)).await
    }

    async fn cached(&self, path: &str, ttl: i64, parse: impl FnOnce(&str) -> Value) -> Result<Value, DataError> {
        let url = url::Url::parse(&format!("{}{path}", self.base_url.trim_end_matches('/'))).map_err(|_| upstream_error(None))?;
        let key = source_cache_key(&format!("ipo-v{PARSER_VERSION}"), &url, "");
        let load = || async {
            let text = self.fetch(&url).await.map_err(|e| format!("{}:{}:{}", e.status, e.code, e.message))?;
            Ok(parse(&text))
        };
        let decode = |m: String| {
            let mut parts = m.splitn(3, ':');
            match (parts.next().and_then(|s| s.parse::<u16>().ok()), parts.next(), parts.next()) {
                (Some(status), Some(code), Some(message)) => DataError::new(message, status, code),
                _ => DataError::new(m.clone(), 502, "UPSTREAM_UNAVAILABLE"),
            }
        };
        if let Some(cache) = &self.cache {
            return cache.remember(&key, ttl, load, None).await.map(|hit| hit.value).map_err(decode);
        }
        let mut local = self.local.lock().await;
        if let Some((expires, value)) = local.get(&key) {
            if *expires > now_ms() {
                return Ok(value.clone());
            }
        }
        let value = load().await.map_err(decode)?;
        local.retain(|_, (expires, _)| *expires > now_ms());
        local.insert(key, (now_ms() + ttl * 1000, value.clone()));
        Ok(value)
    }

    async fn fetch(&self, url: &url::Url) -> Result<String, DataError> {
        let mut last = upstream_error(None);
        for attempt in 0..3u32 {
            match self.client.get(url.clone()).send().await {
                Ok(response) => {
                    let status = response.status().as_u16();
                    if status == 404 {
                        return Err(DataError::new("IPO not found", 404, "NOT_FOUND"));
                    }
                    if (200..300).contains(&status) {
                        return response.text().await.map_err(|_| upstream_error(None));
                    }
                    last = upstream_error(Some(status));
                    if status != 408 && status != 429 && status < 500 {
                        return Err(last);
                    }
                }
                Err(error) => {
                    tracing::warn!(event = "api.ipo.transport_error", path = %url.path(), error = %error);
                }
            }
            tokio::time::sleep(Duration::from_millis(500 * 2u64.pow(attempt))).await;
        }
        Err(last)
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 120 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

fn sel(css: &str) -> Selector {
    Selector::parse(css).expect("valid selector")
}

fn text(el: ElementRef) -> String {
    el.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Numbers in a string, ignoring thousands separators: "₹1,585 – 1,665" -> [1585, 1665].
fn numbers(s: &str) -> Vec<f64> {
    let cleaned: String = s.chars().map(|c| if c == ',' { '\0' } else { c }).filter(|c| *c != '\0').collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in cleaned.chars().chain(std::iter::once(' ')) {
        if c.is_ascii_digit() || (c == '.' && !cur.is_empty()) {
            cur.push(c);
        } else {
            if let Ok(n) = cur.trim_end_matches('.').parse::<f64>() {
                out.push(n);
            }
            cur.clear();
        }
    }
    out
}

fn signed_number(s: &str) -> Option<f64> {
    let n = numbers(s).first().copied()?;
    Some(if s.contains(['-', '−']) { -n } else { n })
}

fn parse_date(s: &str) -> Option<String> {
    ["%d %b %Y", "%d %B %Y", "%Y-%m-%d", "%b %d, %Y"].iter()
        .find_map(|format| chrono::NaiveDate::parse_from_str(s.trim(), format).ok()).map(|d| d.to_string())
}

/// Date-only source values denote midnight in India, never an implicit UTC date.
fn timestamp_dates(value: &mut Value) {
    match value {
        Value::String(s) if s.len() == 10 && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() => {
            s.push_str("T00:00:00+05:30");
        }
        Value::Array(items) => items.iter_mut().for_each(timestamp_dates),
        Value::Object(fields) => fields.values_mut().for_each(timestamp_dates),
        _ => {}
    }
}

fn field_key(label: &str) -> String {
    match label.trim().to_lowercase().as_str() {
        "eps (₹)" | "eps" => return "eps".into(),
        "p/e ratio (x)" | "p/e ratio" => return "peRatio".into(),
        "market cap at offer price (₹ cr)" => return "marketCapCrore".into(),
        "nav (₹)" => return "nav".into(),
        _ => {}
    }
    let mut words = label.split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty());
    let mut key = words.next().unwrap_or("").to_lowercase();
    for word in words {
        let word = word.to_lowercase();
        let mut chars = word.chars();
        if let Some(first) = chars.next() { key.extend(first.to_uppercase()); key.extend(chars); }
    }
    key
}

fn typed_value(raw: &str) -> Value {
    let raw = raw.trim();
    if raw.is_empty() || ["—", "–", "-", "N/A", "NA", "TBA", "TBD"].contains(&raw) { return Value::Null; }
    if let Some(date) = parse_date(raw) { return json!(date); }
    let lower = raw.to_lowercase();
    if lower == "yes" { return json!(true); }
    if lower == "no" { return json!(false); }
    let numeric = lower.replace([',', '₹', '%', '×'], "");
    let numeric = numeric.trim().trim_end_matches("shares").trim_end_matches("share").trim_end_matches('x').trim();
    if let Ok(number) = numeric.parse::<f64>() { return json!(number); }
    for suffix in [" crore", " cr", " lakh", " million"] {
        if let Some(number) = numeric.strip_suffix(suffix).and_then(|s| s.trim().parse::<f64>().ok()) {
            let multiplier = match suffix { " lakh" => 100_000.0, " million" => 1_000_000.0, _ => 10_000_000.0 };
            return json!(number * multiplier);
        }
    }
    json!(raw)
}

/// Convert the private HTML extraction into named, typed public fields.
fn structured_section(section: ElementRef) -> Value {
    if let Some(value) = domain_section(section) { return value; }
    let extracted = section_json(section);
    let mut result = Map::new();
    let fields: &[&str] = match section.value().attr("id").unwrap_or("") {
        "ipo-summary" => &["issueType", "faceValue", "priceBand", "lotSize", "totalIssueSize", "freshIssue", "offerForSale", "listingAt"],
        "timetable" | "ipo-dates" => &["openDate", "closeDate", "allotmentDate", "refundDate", "dematCreditDate", "listingDate"],
        "gmp-today" => &["gmp", "estimatedListingPrice", "expectedGain"],
        "ipo-valuation" => &["eps", "pe", "roe", "roce", "ronw", "nav"],
        _ => &[],
    };
    for field in fields { result.insert((*field).into(), Value::Null); }
    if let Some(facts) = extracted["facts"].as_array() {
        for fact in facts {
            let key = field_key(fact["label"].as_str().unwrap_or(""));
            if key.is_empty() { continue; }
            let raw = fact["value"].as_str().unwrap_or("");
            let value = if key == "priceBand" {
                let values = numbers(raw);
                json!({"low": values.first(), "high": values.last()})
            } else { typed_value(raw) };
            result.insert(key, value);
        }
    }
    let mut tables: Vec<Value> = Vec::new();
    for table in extracted["tables"].as_array().into_iter().flatten() {
        let raw_headers = table["headers"].as_array().cloned().unwrap_or_default();
        let metric_table = raw_headers.first().and_then(Value::as_str).map(|s| matches!(s.to_lowercase().as_str(), "metric" | "valuation metric")).unwrap_or(false)
            || raw_headers.iter().any(|h| h.as_str().map(|s| s.eq_ignore_ascii_case("pre-issue")).unwrap_or(false));
        if metric_table {
            for row in table["rows"].as_array().into_iter().flatten() {
                let key = field_key(row[0].as_str().unwrap_or(""));
                let mut comparison = Map::new();
                for (column, header) in raw_headers.iter().enumerate().skip(1) {
                    comparison.insert(field_key(header.as_str().unwrap_or("")), typed_value(row[column].as_str().unwrap_or("")));
                }
                if !key.is_empty() { result.insert(key, Value::Object(comparison)); }
            }
            continue;
        }
        let headers: Vec<String> = table["headers"].as_array().into_iter().flatten().map(|h| field_key(h.as_str().unwrap_or(""))).collect();
        let rows: Vec<Value> = table["rows"].as_array().into_iter().flatten().map(|row| {
            let mut record = Map::new();
            for (index, key) in headers.iter().enumerate() {
                if !key.is_empty() { record.insert(key.clone(), typed_value(row[index].as_str().unwrap_or(""))); }
            }
            Value::Object(record)
        }).collect();
        tables.push(json!(rows));
    }
    if tables.len() == 1 { result.insert("records".into(), tables[0].clone()); }
    else if !tables.is_empty() { result.insert("records".into(), json!(tables)); }
    let lists: Vec<Value> = extracted["lists"].as_array().into_iter().flatten().flat_map(|l| l.as_array().into_iter().flatten().cloned()).collect();
    if !lists.is_empty() { result.insert("items".into(), json!(lists)); }
    let paragraphs = extracted["paragraphs"].as_array().cloned().unwrap_or_default();
    if !paragraphs.is_empty() { result.insert("description".into(), json!(paragraphs.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n\n"))); }
    if result.is_empty() { return json!({"description": extracted["text"]}); }
    Value::Object(result)
}

fn numeric(raw: &str) -> Value {
    let raw = raw.trim();
    if raw.starts_with(['—', '–']) || raw.is_empty() || raw == "-" || raw == "--x" || raw.eq_ignore_ascii_case("tba") || raw.eq_ignore_ascii_case("not available") { return Value::Null; }
    signed_number(raw).map(|n| json!(n)).unwrap_or(Value::Null)
}

fn table_rows(section: ElementRef) -> Vec<Vec<String>> {
    section.select(&sel("table tr")).map(|row| {
        row.children().filter_map(ElementRef::wrap).filter(|e| matches!(e.value().name(), "td" | "th")).map(text).collect()
    }).filter(|row: &Vec<String>| !row.is_empty()).collect()
}

fn domain_section(section: ElementRef) -> Option<Value> {
    let id = section.value().attr("id")?;
    let rows = table_rows(section);
    fn cell(row: &[String], index: usize) -> &str { row.get(index).map(String::as_str).unwrap_or("") }
    match id {
        "ipo-news" => Some(json!(section.select(&sel("a[href]")).filter_map(|article| {
            let time = article.select(&sel("time[datetime]")).next()?;
            let title = article.select(&sel("span span")).last().map(text)?;
            Some(json!({"title": title, "publishedAt": time.value().attr("datetime")}))
        }).collect::<Vec<_>>())),
        "timetable" | "ipo-dates" => {
            let mut out = json!({"openDate": null, "closeDate": null, "allotmentDate": null, "refundDate": null, "dematCreditDate": null, "listingDate": null});
            for step in section.select(&sel(".dc-tl-step")) {
                let label = step.select(&sel(".dc-tl-label")).next().map(text).unwrap_or_default().to_lowercase();
                let date = step.select(&sel(".dc-tl-date")).next().map(text).unwrap_or_default();
                let year = step.select(&sel(".dc-tl-year")).next().map(text).unwrap_or_default();
                let date = parse_date(&date).or_else(|| parse_date(&format!("{date} {year}")));
                let keys: &[&str] = match label.as_str() { "open" => &["openDate"], "close" => &["closeDate"], "allotment" => &["allotmentDate"], "refund/credit" => &["refundDate", "dematCreditDate"], "listing" => &["listingDate"], _ => &[] };
                for key in keys { out[*key] = json!(date); }
            }
            Some(out)
        }
        "ipo-summary" => {
            let mut out = json!({"priceBand": {"low": null, "high": null}, "faceValue": null, "lotSizeShares": null, "issueSizeCrore": null, "saleType": null, "exchanges": [], "registrar": null, "minimumInvestment": null});
            for row in &rows {
                let raw = cell(row, 1);
                match cell(row, 0).to_lowercase().as_str() {
                    "price band" => { let n = numbers(raw); out["priceBand"] = json!({"low": n.first(), "high": n.last()}); }
                    "face value" => out["faceValue"] = numeric(raw),
                    "lot size" => out["lotSizeShares"] = numeric(raw),
                    "issue size" => out["issueSizeCrore"] = numeric(raw),
                    "sale type" => out["saleType"] = typed_value(raw),
                    "listing on" => out["exchanges"] = json!(raw.split(',').map(str::trim).collect::<Vec<_>>()),
                    "registrar" => out["registrar"] = typed_value(raw),
                    "min investment" => out["minimumInvestment"] = numeric(raw),
                    _ => {}
                }
            }
            Some(out)
        }
        "company-financials" => {
            let headers = rows.first().cloned().unwrap_or_default();
            let mut periods = Vec::new();
            for (column, header) in headers.iter().enumerate().skip(1) {
                let mut period = json!({"date": parse_date(header), "revenueFromOperationsCrore": null, "totalIncomeCrore": null, "profitAfterTaxCrore": null, "netWorthCrore": null, "totalBorrowingCrore": null, "totalAssetsCrore": null});
                for row in rows.iter().skip(1) {
                    let key = match cell(row, 0).to_lowercase().as_str() { "revenue from operations" => "revenueFromOperationsCrore", "total income" => "totalIncomeCrore", "profit after tax" => "profitAfterTaxCrore", "net worth" => "netWorthCrore", "total borrowing" => "totalBorrowingCrore", "total assets" => "totalAssetsCrore", _ => continue };
                    period[key] = numeric(cell(row, column));
                }
                periods.push(period);
            }
            Some(json!(periods))
        }
        "lot-size" => Some(json!(rows.iter().skip(1).map(|row| json!({"category": cell(row, 0), "lots": numeric(cell(row, 1)), "shares": numeric(cell(row, 2)), "amount": numeric(cell(row, 3))})).collect::<Vec<_>>())),
        "gmp-trend" => Some(json!(rows.iter().skip(1).map(|row| json!({"date": parse_date(cell(row, 0)), "gmp": numeric(cell(row, 1)), "change": match cell(row, 2) { "▲" => Some("up"), "▼" => Some("down"), _ => None }, "premiumPercent": numeric(cell(row, 3)), "kostak": numeric(cell(row, 4)), "subjectToSauda": numeric(cell(row, 5))})).collect::<Vec<_>>())),
        "listing-estimate" => {
            let mut out = json!({"issuePrice": null, "gmp": null, "listingDate": null, "estimatedListingPrice": null, "estimatedGainPercent": null});
            for row in &rows {
                let raw = cell(row, 1);
                match cell(row, 0) {
                    "Issue price (upper band)" => out["issuePrice"] = numeric(raw),
                    "Current GMP" => out["gmp"] = numeric(raw),
                    "Listing date" => out["listingDate"] = json!(parse_date(&raw.replace(',', ""))),
                    "GMP-based listing estimate" => { out["estimatedListingPrice"] = numeric(raw); out["estimatedGainPercent"] = json!(numbers(raw).get(1)); }
                    _ => {}
                }
            }
            Some(out)
        }
        "gmp-today" => {
            let mut out = json!({"gmp": null, "estimatedListingPrice": null, "expectedGain": null});
            for stat in section.select(&sel(".dc-stat")) {
                let label = stat.select(&sel(".dc-eyebrow")).next().map(text).unwrap_or_default().to_lowercase();
                let value = stat.select(&sel(".dc-stat-v")).next().map(text).unwrap_or_default();
                if label == "gmp today" {
                    out["gmp"] = numeric(&value);
                    out["expectedGain"] = stat.select(&sel(".dc-stat-s")).next().map(text).map(|s| numeric(&s)).unwrap_or(Value::Null);
                } else if label.contains("listing") { out["estimatedListingPrice"] = numeric(&value); }
            }
            Some(out)
        }
        "analyst-reviews" => Some(json!(rows.iter().skip(1).map(|row| json!({"analyst": cell(row, 0), "verdict": cell(row, 1)})).collect::<Vec<_>>())),
        "live-bidding" => Some(json!(rows.iter().filter(|row| !["Category", ""].contains(&cell(row, 0))).map(|row| json!({"category": cell(row, 0), "offeredShares": numeric(cell(row, 1)), "appliedShares": numeric(cell(row, 2)), "amountCrore": numeric(cell(row, 3)), "subscriptionTimes": numeric(cell(row, row.len().saturating_sub(1)))})).collect::<Vec<_>>())),
        "strengths-risks" => {
            let lists: Vec<Vec<String>> = section.select(&sel("ul, ol")).map(|list| list.select(&sel("li")).map(text).collect()).collect();
            Some(json!({"strengths": lists.first().cloned().unwrap_or_default(), "risks": lists.get(1).cloned().unwrap_or_default()}))
        }
        "anchor-investors" => {
            let headers = rows.first().cloned().unwrap_or_default();
            let subscription = headers.iter().any(|h| h == "Group Entity");
            let offset = if subscription { 1 } else { 0 };
            Some(json!(rows.iter().skip(1).filter(|row| !cell(row, offset).to_lowercase().starts_with("total")).map(|row| json!({
                "investor": cell(row, offset), "fundHouse": cell(row, offset + 1), "shares": numeric(cell(row, offset + 2)),
                "amountCrore": numeric(cell(row, offset + 3)), "anchorBookPercent": numeric(cell(row, offset + 4)),
                "issuePercent": if subscription { numeric(cell(row, offset + 5)) } else { Value::Null }
            })).collect::<Vec<_>>()))
        }
        "review-content" => {
            let mut out = json!({"generalReview": null, "listingGains": null, "shortTermStrategy": null, "longTermStrategy": null});
            let mut key = None;
            for node in section.select(&sel("h3, .dc-prose, p:not(.dc-note)")) {
                if node.value().name() == "h3" { key = match text(node).to_lowercase().as_str() { "general review" => Some("generalReview"), "listing gains" => Some("listingGains"), "short-term strategy" => Some("shortTermStrategy"), "long-term strategy" => Some("longTermStrategy"), _ => None }; }
                else if let Some(key) = key { if out[key].is_null() { out[key] = json!(text(node)); } }
            }
            Some(out)
        }
        "analyst-verdict" => {
            let content = text(section);
            // The score includes a nested `/ 100` label; parse only its first number.
            let score = section.select(&sel(".dc-score")).next()
                .or_else(|| section.select(&sel(".dc-num")).next())
                .and_then(|node| numbers(text(node).split('/').next().unwrap_or("")).first().copied())
                .map_or(Value::Null, |score| json!(score));
            let consensus = ["Strictly Avoid", "Strong Apply", "May Apply", "Neutral", "Avoid"].into_iter().find(|label| content.contains(label));
            Some(json!({"score": score, "maximumScore": 100, "consensus": consensus}))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

fn parse_list(html: &str, kind: &str, page: u32) -> Value {
    let doc = Html::parse_document(html);
    let walker = sel("h2, table.lt tbody tr");
    let (name, time, band, lot, issue, gmp, subscribed) = (
        sel("a.lt-name"), sel("time"), sel("td[data-label='Price band']"), sel("td[data-label='Lot size']"),
        sel("td[data-label='Issue size']"), sel("td[data-label='GMP']"), sel("td[data-label='Subscribed']"),
    );
    let (status_sel, exch, strong, subtext) = (sel(".lt-status"), sel(".lt-exch"), sel(".lt-strong"), sel(".lt-sub"));
    let mut section = String::new();
    let mut items = Vec::new();
    for el in doc.select(&walker) {
        if el.value().name() == "h2" {
            section = el.value().attr("id").unwrap_or("").to_string();
            continue;
        }
        let Some(link) = el.select(&name).next() else { continue };
        let url = link.value().attr("href").unwrap_or("").to_string();
        let id = url.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
        let status_el = el.select(&status_sel).next();
        let status = status_el
            .and_then(|s| s.value().classes().find(|c| c.starts_with("is-")))
            .map(|c| c.trim_start_matches("is-").to_string());
        let listed = matches!(section.trim_end_matches("-h"), "recent" | "past");
        let listing_date = if listed { el.select(&time).next().and_then(|t| t.value().attr("datetime")).map(String::from) } else { None };
        let (open, close) = match el.select(&time).next().filter(|_| !listed) {
            Some(t) => {
                let label = text(t);
                (t.value().attr("datetime").map(String::from), label.rsplit(['–', '-']).next().and_then(parse_date))
            }
            None => (None, None),
        };
        let cell = |s: &Selector| el.select(s).next();
        let band_numbers = cell(&band).map(|c| numbers(&text(c))).unwrap_or_default();
        let lot_cell = cell(&lot);
        let lot_value = lot_cell.and_then(|c| c.select(&subtext).next()).map(|c| numbers(&text(c)).first().copied());
        let gmp_cell = cell(&gmp);
        let gmp_amount = gmp_cell.and_then(|c| c.select(&strong).next()).map(text).filter(|t| !t.is_empty());
        let gmp_percent = gmp_cell.and_then(|c| c.select(&subtext).next()).map(text);
        let subscribed_text = cell(&subscribed).map(text).unwrap_or_default();
        items.push(json!({
            "id": id,
            "name": text(link).trim_end_matches(" IPO").to_string(),
            "section": section.trim_end_matches("-h"),
            "status": if listed { Some("listed".to_string()) } else { status },
            "exchanges": el.select(&exch).next().map(|e| text(e).split(',').map(|s| s.trim().to_string()).collect::<Vec<_>>()).unwrap_or_default(),
            "open": open,
            "close": close,
            "listingDate": listing_date,
            "priceBand": { "low": band_numbers.first(), "high": band_numbers.last() },
            "lotSize": {
                "shares": lot_cell.and_then(|c| numbers(c.text().next().unwrap_or("")).first().copied()),
                "value": lot_value.flatten(),
            },
            "issueSizeCrore": cell(&issue).and_then(|c| numbers(&text(c)).first().copied()),
            "gmp": { "amount": gmp_amount.as_deref().and_then(signed_number), "percent": gmp_percent.as_deref().and_then(signed_number) },
            "subscribedTimes": numbers(&subscribed_text).first(),
        }));
    }
    let has_next = doc.select(&sel("a[rel='next']")).next().is_some();
    let mut response = json!({
        "type": kind,
        "page": page,
        "nextPage": if has_next { json!(page + 1) } else { Value::Null },
        "count": items.len(),
        "items": items,
    });
    timestamp_dates(&mut response);
    response
}

// ---------------------------------------------------------------------------
// Detail pages: every section becomes { id, title, lede, facts, tables, lists, paragraphs, links }
// ---------------------------------------------------------------------------

fn section_json(section: ElementRef) -> Value {
    let (h2, p, th_td, table, ul, a, kicker) = (sel("h2"), sel("p"), sel("tr"), sel("table"), sel("ul, ol"), sel("a[href]"), sel(".dc-kicker"));
    let mut out = Map::new();
    out.insert("id".into(), json!(section.value().attr("id")));
    out.insert("title".into(), json!(section.select(&h2).next().map(text)));
    let lede = section.select(&sel("p.dc-lede")).next().map(text);
    out.insert("lede".into(), json!(lede));

    let mut facts = Vec::new();
    let mut tables = Vec::new();
    for t in section.select(&table) {
        let mut headers: Vec<String> = Vec::new();
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut row_facts = Vec::new();
        for tr in t.select(&th_td) {
            let cells: Vec<String> = tr.children().filter_map(ElementRef::wrap).map(text).collect();
            let all_th = tr.children().filter_map(ElementRef::wrap).all(|c| c.value().name() == "th");
            let row_header = tr.children().filter_map(ElementRef::wrap).next().map(|c| c.value().name() == "th").unwrap_or(false);
            if cells.is_empty() {
                continue;
            }
            if all_th {
                headers = cells;
            } else if row_header && cells.len() == 2 {
                row_facts.push(json!({ "label": cells[0], "value": cells[1] }));
            } else {
                rows.push(cells);
            }
        }
        facts.extend(row_facts);
        if !rows.is_empty() {
            tables.push(json!({ "headers": headers, "rows": rows }));
        }
    }
    // Stat tiles: label element followed by value (and optional note) siblings.
    for k in section.select(&kicker) {
        let mut next = k.next_siblings().filter_map(ElementRef::wrap);
        if let Some(value) = next.next() {
            let value_text = text(value);
            if !value_text.is_empty() && value_text.len() < 120 {
                let note = next.next().map(text).filter(|n| !n.is_empty() && n.len() < 160);
                facts.push(json!({ "label": text(k), "value": value_text, "note": note }));
            }
        }
    }
    let lists: Vec<Vec<String>> = section
        .select(&ul)
        .map(|l| l.children().filter_map(ElementRef::wrap).map(text).filter(|s| !s.is_empty()).collect::<Vec<_>>())
        .filter(|l: &Vec<String>| !l.is_empty())
        .collect();
    let paragraphs: Vec<String> = section
        .select(&p)
        .filter(|e| !e.value().classes().any(|c| c == "dc-lede"))
        .map(text)
        .filter(|s| !s.is_empty())
        .collect();
    let links: Vec<Value> = section
        .select(&a)
        .filter_map(|e| {
            let label = text(e);
            let href = e.value().attr("href")?;
            (label.len() > 2 && href.starts_with("http")).then(|| json!({ "text": label, "url": href }))
        })
        .collect();
    // Fallback for sections whose content sits in plain spans/divs.
    out.insert("text".into(), json!(text(section)));
    out.insert("facts".into(), json!(facts));
    out.insert("tables".into(), json!(tables));
    out.insert("lists".into(), json!(lists));
    out.insert("paragraphs".into(), json!(paragraphs));
    out.insert("links".into(), json!(links));
    Value::Object(out)
}

fn json_ld(doc: &Html) -> Vec<Value> {
    doc.select(&sel("script[type='application/ld+json']"))
        .filter_map(|s| serde_json::from_str::<Value>(&s.text().collect::<String>()).ok())
        .collect()
}

fn faq(blocks: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    for block in blocks {
        let graph = block.get("@graph").and_then(|g| g.as_array()).cloned().unwrap_or_else(|| vec![block.clone()]);
        for node in graph {
            if let Some(entities) = node.get("mainEntity").and_then(|m| m.as_array()) {
                for q in entities {
                    let question = q.get("name").and_then(|v| v.as_str());
                    let answer = q.pointer("/acceptedAnswer/text").and_then(|v| v.as_str());
                    if let (Some(question), Some(answer)) = (question, answer) {
                        out.push(json!({ "question": question, "answer": answer }));
                    }
                }
            }
        }
    }
    out
}

/// `const points = [...]` embedded for the GMP chart.
fn gmp_points(html: &str) -> Vec<Value> {
    let Some(start) = html.find("const points = ") else { return vec![] };
    let rest = &html[start + "const points = ".len()..];
    let Some(end) = rest.find("];") else { return vec![] };
    serde_json::from_str::<Vec<Value>>(&rest[..end + 1])
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let label = p["full_label"].as_str().unwrap_or("");
            let date = label.split_once(", ").and_then(|(date, time)| {
                let date = parse_date(date)?;
                let time = chrono::NaiveTime::parse_from_str(&time.replace(' ', ":00 "), "%I:%M %p").ok()?;
                Some(format!("{date}T{}+05:30", time.format("%H:%M:%S")))
            }).or_else(|| parse_date(label));
            let value = p["price"].as_f64().map(|v| json!(v)).unwrap_or_else(|| typed_value(p["price"].as_str().unwrap_or("")));
            json!({ "date": date, "value": value })
        })
        .collect()
}

/// Map ipoguru section ids to stable response keys per page.
fn key_for(page: Page, section_id: &str) -> Option<&'static str> {
    Some(match (page, section_id) {
        (Page::Detail, "timetable") => "timetable",
        (Page::Detail, "ipo-news") => "news",
        (Page::Detail, "ipo-summary") => "issueSummary",
        (Page::Detail, "lot-size") => "lotSize",
        (Page::Detail, "strengths-risks") => "strengthsAndRisks",
        (Page::Detail, "company-financials") => "financials",
        (Page::Detail, "company-kpis") => "kpis",
        (Page::Detail, "ipo-valuation") => "valuation",
        (Page::Detail, "objects-of-issue") => "objects",
        (Page::Detail, "anchor-investors") => "anchors",
        (Page::Detail, "about-company") => "about",
        (Page::Detail, "docs") => "documentsOverview",
        (Page::Detail, "ipo-documents") => "documents",
        (Page::Detail, "banker-track-record") => "bankers",
        (Page::Gmp, "gmp-today") => "today",
        (Page::Gmp, "gmp-chart") => "trend",
        (Page::Gmp, "gmp-trend") => "dayWise",
        (Page::Gmp, "ipo-dates") => "timetable",
        (Page::Gmp, "listing-estimate") => "expectedListing",
        (Page::Gmp, "gmp-reliability") => "reliability",
        (Page::Gmp, "kostak-explainer") => "kostakAndSauda",
        (Page::Gmp, "about-company") => "company",
        (Page::Subscription, "subscription-status") => "status",
        (Page::Subscription, "live-bidding") => "liveBidding",
        (Page::Subscription, "allotment-probability") => "allotmentOdds",
        (Page::Subscription, "insights") => "insights",
        (Page::Subscription, "day-wise") => "dayWise",
        (Page::Subscription, "ipo-dates") => "timetable",
        (Page::Subscription, "anchor-investors") => "anchors",
        (Page::Subscription, "subscription-meaning") => "readingTheData",
        (Page::Review, "review-hero") => "hero",
        (Page::Review, "analyst-verdict") => "verdict",
        (Page::Review, "review-content") => "detailedReview",
        (Page::Review, "analyst-reviews") => "analystReviews",
        (Page::Review, "latest-reviews") => "latestReviews",
        _ => return None,
    })
}

fn parse_page(html: &str, page: Page, id: &str) -> Value {
    let doc = Html::parse_document(html);
    let mut out = Map::new();
    out.insert("id".into(), json!(id));
    out.insert("name".into(), json!(doc.select(&sel("h1")).next().map(text)));
    // Every known section is present even if the source omits it.
    for section_id in ["timetable", "ipo-news", "ipo-summary", "lot-size", "strengths-risks", "company-financials", "company-kpis", "ipo-valuation", "objects-of-issue", "anchor-investors", "about-company", "docs", "ipo-documents", "banker-track-record", "gmp-today", "gmp-chart", "gmp-trend", "ipo-dates", "listing-estimate", "gmp-reliability", "kostak-explainer", "subscription-status", "live-bidding", "allotment-probability", "insights", "day-wise", "subscription-meaning", "review-hero", "analyst-verdict", "review-content", "analyst-reviews", "latest-reviews"] {
        if let Some(key) = key_for(page, section_id) { out.insert(key.into(), Value::Null); }
    }
    for section in doc.select(&sel("section[id]")) {
        let section_id = section.value().attr("id").unwrap_or("");
        if let Some(key) = key_for(page, section_id) {
            out.insert(key.into(), structured_section(section));
        }
    }
    if page == Page::Gmp {
        out.insert("chart".into(), json!(gmp_points(html)));
    }
    out.insert("faq".into(), json!(faq(&json_ld(&doc))));
    if page == Page::Review {
        let article = json_ld(&doc).into_iter().find_map(|b| {
            b.get("@graph")?.as_array()?.iter().find(|n| n.get("@type") == Some(&json!("Article"))).cloned()
        });
        out.insert("summary".into(), json!(article.as_ref().and_then(|a| a.get("description"))));
    }
    let mut response = Value::Object(out);
    timestamp_dates(&mut response);
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"<h2 id="current-h">Open</h2><table class="lt"><tbody><tr>
      <td class="lt-ipo"><img class="lt-logo" src="https://x/l.webp"><a href="https://www.ipoguru.in/ipo/acme-ipo" class="lt-name">Acme IPO</a>
      <span class="lt-status is-upcoming">Opens 26 Oct</span><span class="lt-exch">BSE, NSE</span></td>
      <td data-label="Dates"><time datetime="2026-10-26">26 Oct – 28 Oct 2026</time></td>
      <td data-label="Price band" class="lt-num">₹1,585 – 1,665</td>
      <td data-label="Lot size" class="lt-num">9 shares <span class="lt-sub">₹14,985</span></td>
      <td data-label="Issue size" class="lt-num">₹1,200 Cr</td>
      <td data-label="GMP" class="lt-num"><span class="lt-strong">₹52</span><span class="lt-sub">+3.12%</span></td>
      <td data-label="Subscribed" class="lt-num">—</td></tr></tbody></table>"#;

    #[test]
    fn review_score_uses_real_source_markup() {
        for (score, expected) in [("20", json!(20.0)), ("0", json!(0.0)), ("—", Value::Null)] {
            let html = format!(r#"<section id="analyst-verdict"><h2>Analyst verdict &amp; score</h2><div class="dc-kicker">Sentiment score</div><div class="dc-score">{score}<small>/ 100</small></div><strong>Strictly Avoid</strong></section>"#);
            let v = parse_page(&html, Page::Review, "acme-ipo");
            assert_eq!(v["verdict"]["score"], expected);
            assert_eq!(v["verdict"]["maximumScore"], 100);
        }
    }

    #[test]
    fn review_prose_and_gmp_stats_match_source_markup() {
        let review = parse_page(r#"<section id="review-content"><h3>General review</h3><div class="dc-prose">Actual analyst summary</div><h3>Long-term strategy</h3><div class="dc-prose">Actual strategy</div><p class="dc-note">How this is written</p></section>"#, Page::Review, "acme-ipo");
        assert_eq!(review["detailedReview"]["generalReview"], "Actual analyst summary");
        assert_eq!(review["detailedReview"]["longTermStrategy"], "Actual strategy");
        let gmp = parse_page(r#"<section id="gmp-today"><div class="dc-stat"><div class="dc-eyebrow">GMP today</div><div class="dc-stat-v">▲ ₹ 33</div><div class="dc-stat-s">+1.98% over ₹1665 issue price</div></div><div class="dc-stat"><div class="dc-eyebrow">Expected listing</div><div class="dc-stat-v">₹1,698</div></div></section>"#, Page::Gmp, "acme-ipo");
        assert_eq!(gmp["today"]["gmp"], 33.0);
        assert_eq!(gmp["today"]["expectedGain"], 1.98);
        assert_eq!(gmp["today"]["estimatedListingPrice"], 1698.0);
    }

    #[test]
    fn list_row_is_parsed() {
        let v = parse_list(LIST, "mainboard", 1);
        let item = &v["items"][0];
        assert_eq!(item["id"], "acme-ipo");
        assert_eq!(item["name"], "Acme");
        assert_eq!(item["status"], "upcoming");
        assert_eq!(item["section"], "current");
        assert_eq!(item["open"], "2026-10-26T00:00:00+05:30");
        assert_eq!(item["close"], "2026-10-28T00:00:00+05:30");
        assert!(item.get("statusLabel").is_none());
        assert_eq!(item["priceBand"]["low"], 1585.0);
        assert_eq!(item["priceBand"]["high"], 1665.0);
        assert_eq!(item["lotSize"]["shares"], 9.0);
        assert_eq!(item["lotSize"]["value"], 14985.0);
        assert_eq!(item["issueSizeCrore"], 1200.0);
        assert_eq!(item["gmp"]["amount"], 52.0);
        assert_eq!(item["gmp"]["percent"], 3.12);
        assert!(item["subscribedTimes"].is_null());
    }

    #[test]
    fn news_extracts_articles_not_navigation_and_metrics_are_keyed() {
        let html = r#"<section id="ipo-news"><a href="/news/story"><span><time datetime="2026-10-20T13:34:03+05:30">20 Oct</time><span>Company announces IPO</span></span></a><p><a href="/news">All IPO news →</a></p></section>
        <section id="company-kpis"><table><tr><th>Valuation Metric</th><th>Pre-Issue</th><th>Post-Issue</th></tr><tr><td>EPS (₹)</td><td>₹41.02</td><td>₹49.93</td></tr><tr><td>P/E Ratio (x)</td><td>40.59</td><td>33.35</td></tr></table></section>"#;
        let v = parse_page(html, Page::Detail, "acme-ipo");
        assert_eq!(v["news"], json!([{"title":"Company announces IPO", "publishedAt":"2026-10-20T13:34:03+05:30"}]));
        assert_eq!(v["kpis"]["eps"], json!({"preIssue":41.02,"postIssue":49.93}));
        assert_eq!(v["kpis"]["peRatio"]["postIssue"], 33.35);
        assert!(v["kpis"].get("records").is_none());
    }

    #[test]
    fn financials_are_period_records_with_explicit_units() {
        let html = r#"<section id="company-financials"><table><tr><th>Metric</th><th>30 Jun 2026</th><th>31 Mar 2026</th></tr><tr><td>Total Income</td><td>336.13</td><td>963.76</td></tr><tr><td>Profit After Tax</td><td>80.71</td><td>265.20</td></tr></table></section>"#;
        let v = parse_page(html, Page::Detail, "acme-ipo");
        assert_eq!(v["financials"][0]["date"], "2026-06-30T00:00:00+05:30");
        assert_eq!(v["financials"][0]["totalIncomeCrore"], 336.13);
        assert_eq!(v["financials"][1]["profitAfterTaxCrore"], 265.20);
        assert!(v["financials"][0]["totalAssetsCrore"].is_null());
    }

    #[test]
    fn gmp_history_has_typed_fields_and_missing_values() {
        let html = r#"<section id="gmp-trend"><table><tr><th>Date</th><th>GMP</th><th>↑↓</th><th>%</th><th>Kostak</th><th>Sub. Sauda</th></tr><tr><td>25 Oct 2026</td><td>₹33</td><td>▼</td><td>1.98%</td><td>—</td><td>₹300</td></tr></table></section>"#;
        let v = parse_page(html, Page::Gmp, "acme-ipo");
        assert_eq!(v["dayWise"][0], json!({"date":"2026-10-25T00:00:00+05:30", "gmp":33.0, "change":"down", "premiumPercent":1.98, "kostak":null, "subjectToSauda":300.0}));
    }

    #[test]
    fn typed_contract_values() {
        assert_eq!(typed_value("₹1,200"), json!(1200.0));
        assert_eq!(typed_value("3.12%"), json!(3.12));
        assert_eq!(typed_value("₹50 Cr"), json!(500000000.0));
        assert_eq!(typed_value("26 Oct 2026"), json!("2026-10-26"));
        assert!(typed_value("—").is_null());
        assert_eq!(typed_value("Debt repayment"), json!("Debt repayment"));
        let v = parse_page("<h1>Acme</h1>", Page::Detail, "acme-ipo");
        assert!(v.as_object().unwrap().contains_key("issueSummary"));
        assert!(v["issueSummary"].is_null());
        assert!(v.get("sections").is_none());
        let list = parse_list(LIST, "mainboard", 1);
        assert!(list.get("source").is_none());
        assert!(list["items"][0].get("url").is_none());
    }

    #[test]
    fn ids_are_validated() {
        assert!(valid_id("eaaa-india-alternatives-ipo"));
        assert!(!valid_id("../etc"));
        assert!(!valid_id(""));
    }

    #[test]
    fn section_facts_and_chart_points() {
        let html = r#"<section id="ipo-summary"><h2>Issue summary</h2><table><tr><th scope="row">Lot Size</th><td>9 Shares</td></tr></table></section>
          <script>const points = [{"full_label":"21 Oct 2026, 11 AM","price":5,"tick":""}];
          x</script>"#;
        let v = parse_page(html, Page::Detail, "a-ipo");
        assert_eq!(v["issueSummary"]["lotSizeShares"], 9.0);
        assert!(v["issueSummary"]["faceValue"].is_null());
        assert!(v.get("source").is_none());
        assert!(v.get("url").is_none());
        assert_eq!(gmp_points(html)[0]["value"], 5.0);
        assert_eq!(gmp_points(html)[0]["date"], "2026-10-21T11:00:00+05:30");
    }

    use axum::{extract::State, http::StatusCode, response::Html, routing::get, Router};
    use std::sync::atomic::{AtomicUsize, Ordering};

    const DETAIL: &str = r#"<html><h1>Acme IPO</h1>
      <section id="ipo-summary"><h2>Issue summary</h2><p class="dc-lede">Terms.</p>
        <table><tr><th scope="row">Price Band</th><td>₹10 – ₹12</td></tr></table></section>
      <section id="gmp-chart"><h2>GMP trend</h2><div class="dc-kicker">Peak GMP</div><div>₹121</div><div>23 Oct 2026</div></section>
      <section id="objects-of-issue"><h2>Where the money goes</h2><div><span>Repay debt</span><span>₹50 Cr</span></div></section>
      <script type="application/ld+json">{"@type":["WebPage","FAQPage"],"mainEntity":[{"@type":"Question","name":"When?","acceptedAnswer":{"@type":"Answer","text":"Soon."}}]}</script>
      <script>const points = [{"full_label":"21 Oct 2026, 11 AM","price":5,"tick":"21 Oct"}];
      x</script></html>"#;

    async fn fixture() -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
        let hits = Arc::new(AtomicUsize::new(0));
        async fn list(State(h): State<Arc<AtomicUsize>>) -> Html<&'static str> {
            h.fetch_add(1, Ordering::SeqCst);
            Html(LIST)
        }
        async fn detail(State(h): State<Arc<AtomicUsize>>, axum::extract::Path(id): axum::extract::Path<String>) -> Result<Html<&'static str>, StatusCode> {
            h.fetch_add(1, Ordering::SeqCst);
            if id == "missing-ipo" { Err(StatusCode::NOT_FOUND) } else { Ok(Html(DETAIL)) }
        }
        let app = Router::new()
            .route("/mainboard-ipos", get(list))
            .route("/sme-ipos", get(list))
            .route("/ipo/:id", get(detail))
            .route("/ipo-gmp/:id", get(detail))
            .with_state(hits.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        (base, hits, tokio::spawn(async move { axum::serve(listener, app).await.unwrap() }))
    }

    #[tokio::test]
    async fn list_and_pages_are_scraped_once_then_served_from_cache() {
        let (base, hits, server) = fixture().await;
        let ipo = Ipo::new(base, None);

        let first = ipo.list("mainboard", 1).await.unwrap();
        let second = ipo.list("mainboard", 1).await.unwrap();
        assert_eq!(first["items"][0]["id"], "acme-ipo");
        assert_eq!(first, second, "second call reuses the cached document");
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        ipo.list("sme", 1).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 2, "different type is a different cache entry");

        let gmp = ipo.page(Page::Gmp, "acme-ipo").await.unwrap();
        assert_eq!(gmp["name"], "Acme IPO");
        assert_eq!(gmp["chart"][0]["value"], 5.0);
        assert_eq!(gmp["trend"]["peakGmp"], 121.0);
        assert_eq!(gmp["faq"][0]["answer"], "Soon.");
        let detail = ipo.page(Page::Detail, "acme-ipo").await.unwrap();
        assert_eq!(detail["issueSummary"]["priceBand"]["low"], 10.0);
        assert!(detail["objects"]["description"].as_str().unwrap().contains("Repay debt"));
        assert!(detail.get("fetchedAt").is_none());
        server.abort();
    }

    #[tokio::test]
    async fn invalid_input_and_upstream_404_map_to_errors() {
        let (base, hits, server) = fixture().await;
        let ipo = Ipo::new(base, None);
        assert_eq!(ipo.list("bonds", 1).await.unwrap_err().status, 400);
        assert_eq!(ipo.page(Page::Detail, "../x").await.unwrap_err().status, 400);
        assert_eq!(hits.load(Ordering::SeqCst), 0, "invalid input never reaches the source");
        let missing = ipo.page(Page::Detail, "missing-ipo").await.unwrap_err();
        assert_eq!((missing.status, missing.code.as_str()), (404, "NOT_FOUND"));
        assert_eq!(hits.load(Ordering::SeqCst), 1, "404 is not retried");
        ipo.page(Page::Detail, "missing-ipo").await.unwrap_err();
        assert_eq!(hits.load(Ordering::SeqCst), 2, "failures are never cached");
        server.abort();
    }
}
