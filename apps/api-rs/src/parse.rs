//! HTML parsing ported from the TypeScript scraper helpers. Selector-for-selector
//! equivalents using the `scraper` crate, with identical edge-case behaviour.

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("static selector")
}

fn text_of(el: scraper::ElementRef<'_>) -> String {
    el.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/// Mirrors numericValue: strip commas/₹/% and trailing Cr./Rs., strict float.
pub fn numeric_value(text: &str) -> Option<f64> {
    let mut value = text.replace(',', "");
    value = value.replace(['₹', '%'], "");
    let trimmed = value.trim();
    let lower = trimmed.to_lowercase();
    let stripped = if lower.ends_with("cr.") || lower.ends_with("rs.") {
        trimmed[..trimmed.len() - 3].trim()
    } else if lower.ends_with("cr") || lower.ends_with("rs") {
        trimmed[..trimmed.len() - 2].trim()
    } else {
        trimmed
    };
    if stripped.is_empty() {
        return None;
    }
    let mut chars = stripped.chars().peekable();
    if chars.peek() == Some(&'-') {
        chars.next();
    }
    let mut digits = 0;
    let mut dot = false;
    for c in chars {
        if c.is_ascii_digit() {
            digits += 1;
        } else if c == '.' && !dot {
            dot = true;
        } else {
            return None;
        }
    }
    if digits == 0 {
        return None;
    }
    stripped.parse::<f64>().ok().filter(|n| n.is_finite())
}

/// Company-list variant: unparseable becomes 0.
pub fn safe_parse_float(value: &str) -> f64 {
    value.replace(',', "").parse::<f64>().unwrap_or(0.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BaseValue {
    One,
    Ten,
    Hundred,
    Thousand,
    Lakh,
    Crore,
    Percent,
    Ratio,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NumberData {
    pub amount: f64,
    #[serde(rename = "baseValue")]
    pub base_value: BaseValue,
}

/// Mirrors parseNumberData exactly, including the 0 fallback.
pub fn parse_number_data(value: Option<&str>, base: BaseValue) -> NumberData {
    let Some(raw) = value else {
        return NumberData { amount: 0.0, base_value: base };
    };
    if raw.trim().is_empty() {
        return NumberData { amount: 0.0, base_value: base };
    }
    let mut clean = raw.replace(',', "");
    clean = clean.trim().to_string();
    let mut base_value = base;
    if clean.ends_with('%') {
        base_value = BaseValue::Percent;
        clean = clean.trim_end_matches('%').trim().to_string();
    } else if clean.to_lowercase().contains("cr") {
        base_value = BaseValue::Crore;
        clean = clean.replace("cr.", "").replace("Cr.", "").replace("CR.", "").trim().to_string();
    }
    let numeric: String = clean.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
    let amount = numeric.parse::<f64>().unwrap_or(0.0);
    NumberData { amount: if amount.is_nan() { 0.0 } else { amount }, base_value }
}

// ---------------------------------------------------------------------------
// Symbols, dates
// ---------------------------------------------------------------------------

/// A symbol is a company URL path, never an exchange ticker.
pub fn valid_company_path(path: &str) -> bool {
    let with_slash = if path.ends_with('/') { path.to_string() } else { format!("{path}/") };
    let lower = with_slash.to_lowercase();
    let rest = match lower.strip_prefix("/company/") {
        Some(r) => r,
        None => return false,
    };
    // Optional trailing consolidated/.
    let (segment, consolidated) = match rest.strip_suffix("/consolidated/") {
        Some(s) => (s, true),
        None => (rest.strip_suffix('/').unwrap_or(rest), false),
    };
    let _ = consolidated;
    if let Some(id) = segment.strip_prefix("id/") {
        return !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit());
    }
    if segment.is_empty() || segment.contains('/') {
        return false;
    }
    // [A-Z0-9] first, then [A-Z0-9&_-] or %26.
    let mut chars = segment.bytes().peekable();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    while let Some(b) = chars.next() {
        if b.is_ascii_alphanumeric() || b == b'&' || b == b'_' || b == b'-' {
            continue;
        }
        if b == b'%' {
            if chars.next() != Some(b'2') || chars.next() != Some(b'6') {
                return false;
            }
            continue;
        }
        return false;
    }
    true
}

pub fn valid_date(value: &str) -> bool {
    if value.len() != 10 {
        return false;
    }
    match chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        Ok(d) => d.format("%Y-%m-%d").to_string() == value,
        Err(_) => false,
    }
}

fn month_index(name: &str) -> Option<u32> {
    let short = name.get(..3)?.to_lowercase();
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        .iter()
        .position(|m| *m == short)
        .map(|i| i as u32 + 1)
}

/// Mirrors sourceDate: "2024 May 14" or "14 May 2024" to YYYY-MM-DD.
pub fn source_date(text: &str) -> Option<String> {
    let parts: Vec<&str> = text.trim().split_whitespace().collect();
    if parts.len() != 3 {
        return None;
    }
    let (year, month, day): (i32, u32, u32) = if parts[0].len() == 4 {
        (parts[0].parse().ok()?, month_index(parts[1])?, parts[2].parse().ok()?)
    } else if parts[2].len() == 4 {
        (parts[2].parse().ok()?, month_index(parts[1])?, parts[0].parse().ok()?)
    } else {
        return None;
    };
    let date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
    Some(date.format("%Y-%m-%d").to_string())
}

pub fn next_page(html: &str, current: i64) -> Option<i64> {
    let doc = Html::parse_document(html);
    let selector = sel(".pagination a[href], .paginator a[href]");
    let mut best: Option<i64> = None;
    for el in doc.select(&selector) {
        let href = match el.value().attr("href") {
            Some(h) => h,
            None => continue,
        };
        let url = url::Url::parse("https://source.invalid").ok().and_then(|base| base.join(href).ok());
        let page = url.as_ref().and_then(|u| {
            u.query_pairs().find_map(|(k, v)| {
                if k == "page" || k == "p" {
                    v.parse::<i64>().ok()
                } else {
                    None
                }
            })
        });
        if let Some(p) = page {
            if p > current && p.to_string().parse::<i64>().is_ok() {
                best = Some(best.map_or(p, |b: i64| b.min(p)));
            }
        }
    }
    best
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialRow {
    pub header: String,
    pub values: indexmap::IndexMap<String, Option<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentLink {
    pub title: String,
    pub url: String,
    pub date: Option<String>,
    pub year: Option<i32>,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Classification {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Analysis {
    pub pros: Vec<String>,
    pub cons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanySnapshot {
    pub symbol: String,
    pub ref_id: String,
    pub warehouse_id: String,
    pub name: String,
    pub bse_code: Option<String>,
    pub nse_code: Option<String>,
    pub website: Option<String>,
    pub description: String,
    pub key_points: String,
    pub analysis: Analysis,
    pub consolidated: bool,
    pub classifications: HashMap<String, Classification>,
    pub summary: HashMap<String, Option<f64>>,
    pub change: Option<String>,
    pub tables: HashMap<String, Vec<FinancialRow>>,
    pub documents: Vec<DocumentLink>,
    pub quarterly_source_urls: Vec<String>,
    pub peer_sector: String,
}

fn dated_link(text: &str, now_year: i32, now_ms: i64) -> Option<String> {
    // Find "d MMM [yyyy]" without a regex engine.
    let tokens: Vec<&str> = text.split_whitespace().collect();
    for (i, token) in tokens.iter().enumerate() {
        let day: u32 = match token.trim_end_matches(',').parse() {
            Ok(d) => d,
            Err(_) => continue,
        };
        let month = match tokens.get(i + 1).and_then(|m| month_index(m)) {
            Some(m) => m,
            None => continue,
        };
        let year_token = tokens.get(i + 2).filter(|t| t.len() == 4 && t.starts_with("20"));
        let mut year = year_token.and_then(|t| t.parse::<i32>().ok()).unwrap_or(now_year);
        if year_token.is_none() {
            if let Some(candidate) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
                let candidate_ms = candidate.and_hms_opt(0, 0, 0).map(|t| t.and_utc().timestamp_millis()).unwrap_or(0);
                if candidate_ms > now_ms {
                    year -= 1;
                }
            }
        }
        let date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
        return Some(date.format("%Y-%m-%d").to_string());
    }
    None
}

pub fn parse_company_snapshot(html: &str, symbol: &str, consolidated: bool) -> Result<CompanySnapshot, String> {
    let doc = Html::parse_document(html);
    let info = doc.select(&sel("#company-info")).next().ok_or("Source did not return a company page")?;
    let ref_id = info.value().attr("data-company-id").ok_or("Source did not return a company page")?.to_string();
    let warehouse_id = info.value().attr("data-warehouse-id").unwrap_or(&ref_id).to_string();
    let name = doc.select(&sel("#top h1")).next().map(text_of).unwrap_or_default();
    if ref_id.is_empty() || name.is_empty() {
        return Err("Source did not return a company page".to_string());
    }

    let mut nse: Option<String> = None;
    let mut bse: Option<String> = None;
    let mut website: Option<String> = None;
    for a in doc.select(&sel("#top a")) {
        let href = match a.value().attr("href") {
            Some(h) if h.starts_with("http") => h.to_string(),
            _ => continue,
        };
        let text = text_of(a);
        if text.contains("NSE:") && nse.is_none() {
            nse = Some(text);
        } else if text.contains("BSE:") && bse.is_none() {
            bse = Some(text);
        } else if website.is_none() {
            let host_ok = url::Url::parse(&href)
                .map(|u| !u.host_str().unwrap_or("").contains("nseindia.com") && !u.host_str().unwrap_or("").contains("bseindia.com"))
                .unwrap_or(false);
            if host_ok {
                website = Some(href);
            }
        }
    }
    // TS picks the first non-exchange http link; replicate: prefer nothing else.
    // TS matches the first digit run in the whole "BSE: 123" text.
    let bse_code = bse.as_ref().and_then(|t| {
        let mut digits = String::new();
        let mut started = false;
        for c in t.chars() {
            if c.is_ascii_digit() {
                digits.push(c);
                started = true;
            } else if started {
                break;
            }
        }
        if digits.is_empty() { None } else { Some(digits) }
    });
    let nse_code = nse.as_ref().and_then(|t| t.split(':').nth(1)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    let mut summary: HashMap<String, Option<f64>> = HashMap::new();
    for li in doc.select(&sel("#top-ratios li")) {
        let label = li.select(&sel(".name")).next().map(text_of).unwrap_or_default();
        let text = li.select(&sel(".value")).next().map(text_of).unwrap_or_default();
        if label == "High / Low" {
            let mut parts = text.split('/');
            summary.insert("high52".to_string(), numeric_value(parts.next().unwrap_or("")));
            summary.insert("low52".to_string(), numeric_value(parts.next().unwrap_or("")));
        } else {
            summary.insert(label, numeric_value(&text));
        }
    }

    let groups = ["macro_sector", "industry", "sector", "sub_industry"];
    let mut classifications: HashMap<String, Classification> = HashMap::new();
    for a in doc.select(&sel("#peers a")) {
        let path = match a.value().attr("href") {
            Some(h) if h.starts_with("/market/") => h.to_string(),
            _ => continue,
        };
        let depth = path.split('/').filter(|s| !s.is_empty()).count();
        if depth >= 2 {
            if let Some(group) = groups.get(depth - 2) {
                classifications.insert(group.to_string(), Classification { name: text_of(a), path });
            }
        }
    }

    let mut tables: HashMap<String, Vec<FinancialRow>> = HashMap::new();
    for section in ["quarters", "profit-loss", "balance-sheet", "cash-flow", "ratios", "quarterly-shp", "yearly-shp"] {
        let table_sel = format!("#{section} table");
        let table = match doc.select(&sel(&table_sel)).next() {
            Some(t) => t,
            None => {
                tables.insert(section.to_string(), vec![]);
                continue;
            }
        };
        let headers: Vec<String> = table.select(&sel("thead th")).skip(1).map(text_of).collect();
        let mut rows: Vec<FinancialRow> = headers.iter().map(|h| FinancialRow { header: h.clone(), values: indexmap::IndexMap::new() }).collect();
        for tr in table.select(&sel("tbody tr")) {
            let cells: Vec<_> = tr.select(&sel("td")).collect();
            if cells.is_empty() {
                continue;
            }
            let label = text_of(cells[0]).replace('+', "");
            let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
            if label.is_empty() || label == "Raw PDF" || cells.len() != headers.len() + 1 {
                continue;
            }
            for (i, td) in cells.iter().skip(1).enumerate() {
                if let Some(row) = rows.get_mut(i) {
                    row.values.insert(label.clone(), numeric_value(&text_of(*td)));
                }
            }
        }
        tables.insert(section.to_string(), rows);
    }

    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let now_year = chrono::DateTime::from_timestamp_millis(now_ms).map(|d| d.format("%Y").to_string().parse::<i32>().unwrap_or(2026)).unwrap_or(2026);
    let mut documents: Vec<DocumentLink> = vec![];
    for (selector_str, kind) in [(".annual-reports li", "report"), ("#company-announcements-tab li", "announcement"), (".credit-ratings li", "credit-rating"), (".concalls li", "concall")] {
        for li in doc.select(&sel(selector_str)) {
            let text = text_of(li);
            for a in li.select(&sel("a")) {
                let href = match a.value().attr("href") {
                    Some(h) if h.starts_with("http") => h.to_string(),
                    _ => continue,
                };
                // Title without child elements' text.
                let title = a.text().collect::<Vec<_>>().join(" ").trim().to_string();
                let year = text.split_whitespace().find_map(|t| {
                    if t.len() == 4 && t.starts_with("20") {
                        t.parse::<i32>().ok()
                    } else {
                        None
                    }
                });
                let doc_kind = if kind == "concall" {
                    if title.to_lowercase().contains("transcript") {
                        "transcript"
                    } else if title.contains("PPT") {
                        "presentation"
                    } else {
                        "other"
                    }
                } else {
                    kind
                };
                documents.push(DocumentLink { title, url: href, date: dated_link(&text, now_year, now_ms), year, kind: doc_kind.to_string() });
            }
        }
    }

    let change = doc
        .select(&sel("#top .font-size-12"))
        .map(text_of)
        .find(|t| {
            let t = t.trim();
            match t.strip_suffix('%') {
                Some(num) => !num.is_empty() && num.parse::<f64>().is_ok() && !num.contains(char::is_whitespace),
                None => false,
            }
        });

    // Key points: div.title containing "Key Points" -> next .sub.commentary.
    let mut key_points = String::new();
    for title in doc.select(&sel("div.title")) {
        if text_of(title).contains("Key Points") {
            let mut sibling = title.next_sibling();
            while let Some(node) = sibling {
                if let Some(el) = scraper::ElementRef::wrap(node) {
                    let classes = el.value().classes().collect::<Vec<_>>();
                    if classes.contains(&"sub") && classes.contains(&"commentary") {
                        key_points = text_of(el);
                        break;
                    }
                }
                sibling = node.next_sibling();
            }
            break;
        }
    }

    let mut quarterly_source_urls = vec![];
    for a in doc.select(&sel("#quarters tbody tr td a")) {
        // TS selector: tr.font-size-14.ink-600 — approximate with class check.
        let mut p = a.parent();
        let mut ok_tr = false;
        while let Some(node) = p {
            if let Some(el) = scraper::ElementRef::wrap(node) {
                if el.value().name() == "tr" {
                    let classes = el.value().classes().collect::<Vec<_>>();
                    ok_tr = classes.contains(&"font-size-14") && classes.contains(&"ink-600");
                    break;
                }
            }
            p = node.parent();
        }
        if ok_tr {
            quarterly_source_urls.push(a.value().attr("href").unwrap_or("").to_string());
        }
    }

    let peer_sector = doc.select(&sel("p.sub")).next().map(text_of).unwrap_or_default();

    Ok(CompanySnapshot {
        symbol: symbol.to_string(),
        ref_id,
        warehouse_id,
        name,
        bse_code,
        nse_code,
        website,
        description: doc.select(&sel(".about p")).next().map(text_of).unwrap_or_default(),
        key_points,
        analysis: Analysis {
            pros: doc.select(&sel(".pros ul li")).map(text_of).collect(),
            cons: doc.select(&sel(".cons ul li")).map(text_of).collect(),
        },
        consolidated,
        classifications,
        summary,
        change,
        tables,
        documents,
        quarterly_source_urls,
        peer_sector,
    })
}

// ---------------------------------------------------------------------------
// Peers, admin rows, corporate actions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerRow {
    pub symbol: String,
    pub name: String,
    #[serde(rename = "currentPrice")]
    pub current_price: Option<f64>,
    #[serde(rename = "stockPE")]
    pub stock_pe: Option<f64>,
    #[serde(rename = "marketCap")]
    pub market_cap: Option<f64>,
    #[serde(rename = "dividendYield")]
    pub dividend_yield: Option<f64>,
    #[serde(rename = "netProfitLatestQuarter")]
    pub net_profit_latest_quarter: Option<f64>,
    #[serde(rename = "YOYQuarterlyProfitGrowth")]
    pub yoy_quarterly_profit_growth: Option<f64>,
    #[serde(rename = "salesLatestQuarter")]
    pub sales_latest_quarter: Option<f64>,
    #[serde(rename = "YOYQuarterlySalesGrowth")]
    pub yoy_quarterly_sales_growth: Option<f64>,
    #[serde(rename = "ROCE")]
    pub roce: Option<f64>,
}

pub fn parse_peer_comparison(html: &str) -> Result<Vec<PeerRow>, String> {
    let doc = Html::parse_document(html);
    if doc.select(&sel("table.data-table")).next().is_none() {
        return Err("Source did not return a peer comparison table".to_string());
    }
    let mut rows = vec![];
    for tr in doc.select(&sel("table.data-table tbody tr")) {
        let cells: Vec<_> = tr.select(&sel("td")).collect();
        let link = tr.select(&sel("a[href]")).find(|a| a.value().attr("href").map(|h| h.starts_with("/company/")).unwrap_or(false));
        let Some(link) = link else { continue };
        let cell = |i: usize| cells.get(i).map(|c| text_of(*c)).unwrap_or_default();
        rows.push(PeerRow {
            symbol: link.value().attr("href").unwrap_or("").to_string(),
            name: text_of(link).trim().to_string(),
            current_price: numeric_value(&cell(2)),
            stock_pe: numeric_value(&cell(3)),
            market_cap: numeric_value(&cell(4)),
            dividend_yield: numeric_value(&cell(5)),
            net_profit_latest_quarter: numeric_value(&cell(6)),
            yoy_quarterly_profit_growth: numeric_value(&cell(7)),
            sales_latest_quarter: numeric_value(&cell(8)),
            yoy_quarterly_sales_growth: numeric_value(&cell(9)),
            roce: numeric_value(&cell(10)),
        });
    }
    Ok(rows)
}

#[derive(Debug, Clone)]
pub struct AdminRow {
    pub symbol: Option<String>,
    pub name: String,
    pub fields: HashMap<String, String>,
}

pub fn parse_admin_rows(html: &str) -> Result<Vec<AdminRow>, String> {
    let doc = Html::parse_document(html);
    if doc.select(&sel("#result_list")).next().is_none() {
        return Err("Source did not return a data table".to_string());
    }
    let mut rows = vec![];
    for tr in doc.select(&sel("#result_list tbody tr")) {
        let company = tr
            .select(&sel("a[href]"))
            .filter(|a| a.value().attr("href").map(|h| h.starts_with("/company/")).unwrap_or(false) && !text_of(*a).trim().is_empty())
            .next();
        let mut fields = HashMap::new();
        for td in tr.select(&sel("td")) {
            if let Some(class) = td.value().attr("class") {
                for token in class.split_whitespace() {
                    if let Some(key) = token.strip_prefix("field-") {
                        if key.chars().all(|c| c.is_alphanumeric() || c == '_') {
                            fields.insert(key.to_string(), text_of(td));
                        }
                    }
                }
            }
        }
        rows.push(AdminRow {
            symbol: company.and_then(|a| a.value().attr("href")).map(|s| s.to_string()),
            name: company.map(text_of).unwrap_or_default(),
            fields,
        });
    }
    Ok(rows)
}

#[derive(Debug, Clone)]
pub struct CorpAction {
    pub kind: String,
    pub date: Option<String>,
    pub title: String,
    pub description: String,
}

pub fn parse_corporate_actions(html: &str) -> Result<Vec<CorpAction>, String> {
    let doc = Html::parse_document(html);
    // Sections with id starting corporate-actions-.
    let mut sections: Vec<(String, scraper::ElementRef)> = vec![];
    collect_sections(doc.root_element(), &mut sections);
    if sections.is_empty() {
        return Err("Source did not return corporate actions".to_string());
    }
    let mut actions = vec![];
    for (id, section) in sections {
        let kind = id.strip_prefix("corporate-actions-").unwrap_or(&id).to_string();
        for tr in section.select(&sel("tbody tr")) {
            let cells: Vec<_> = tr.select(&sel("td")).collect();
            if cells.is_empty() {
                continue;
            }
            let first = cells[0];
            let has_children = first.first_child().is_some();
            let raw = if has_children {
                first.children().filter_map(scraper::ElementRef::wrap).map(text_of).collect::<Vec<_>>().join(" ")
            } else {
                text_of(first)
            };
            let date_text = raw.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string();
            let title = cells.get(1).map(|c| c.select(&sel(".font-weight-500")).next().map(text_of).unwrap_or_default()).unwrap_or_default();
            let description = cells.get(1).map(|c| c.select(&sel(".sub")).next().map(text_of).unwrap_or_default()).unwrap_or_default();
            actions.push(CorpAction { kind: kind.clone(), date: source_date(&date_text), title, description });
        }
    }
    Ok(actions)
}

fn collect_sections<'a>(el: scraper::ElementRef<'a>, out: &mut Vec<(String, scraper::ElementRef<'a>)>) {
    // Manual recursion over element children (lifetime-safe via explicit stack in caller).
    for child in el.child_elements() {
        if let Some(id) = child.value().attr("id") {
            if id.starts_with("corporate-actions-") {
                out.push((id.to_string(), child));
            }
        }
        collect_sections(child, out);
    }
}
