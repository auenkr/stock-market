//! GetCompanyData port: full company payload assembled from the snapshot,
//! schedule details, peers and (best-effort) news.

use crate::{
    error::DataError,
    parse::*,
    provider::Provider,
    source::Source,
};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn base_for(row_title: &str) -> BaseValue {
    if row_title.contains('%') {
        BaseValue::Percent
    } else if row_title.contains("P/E") {
        BaseValue::Ratio
    } else if row_title.contains("EPS") || row_title.to_lowercase().contains("days") || row_title.contains("No. of Shareholders") {
        BaseValue::One
    } else {
        BaseValue::Crore
    }
}

const DETAIL_KEYS: &[&str] = &[
    "sales", "expenses", "otherIncome", "netProfit", "borrowings", "otherLiabilities", "fiexedAssets", "otherAssets",
    "operatingActivities", "investingActivities", "financingActivities", "promoters", "FIIS", "DIIS", "public", "government",
];

type ScheduleMap = HashMap<String, HashMap<String, HashMap<String, String>>>;

async fn extract_table(
    snapshot: &CompanySnapshot,
    section: &str,
    row_to_field: &HashMap<&str, &str>,
    detail_fields: &std::collections::HashSet<&str>,
    source: &Source,
) -> Result<Vec<Value>, DataError> {
    let section_key = section.trim_start_matches('#');
    let rows = snapshot.tables.get(section_key).cloned().unwrap_or_default();
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let mut statements: Vec<Map<String, Value>> = rows.iter().map(|r| [("timePeriod".to_string(), Value::String(r.header.clone()))].into_iter().collect()).collect();

    let mut all_data: ScheduleMap = HashMap::new();
    for field in detail_fields {
        let mut url = format!("/api/company/{}/schedules/?parent={field}&section={section_key}", snapshot.ref_id);
        if snapshot.consolidated {
            url.push_str("&consolidated=true");
        }
        let fetched = source.get_text(&url, true).await?;
        let raw: Value = serde_json::from_str(&fetched.text)
            .map_err(|_| DataError::new("Source detail rows could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"))?;
        let raw = match raw {
            Value::Object(map) if map.values().all(|v| v.is_object()) => map,
            _ => return Err(DataError::new("Source detail row format changed", 502, "UPSTREAM_SCHEMA_CHANGED")),
        };
        // Only upstream misses need pacing; cached details add no traffic.
        if !fetched.hit {
            source.pace().await;
        }
        let mut data_map: HashMap<String, HashMap<String, String>> = HashMap::new();
        for (key, value) in &raw {
            if let Value::Object(inner) = value {
                let mut item = HashMap::new();
                for (k, v) in inner {
                    item.insert(k.clone(), v.as_str().unwrap_or("").to_string());
                }
                data_map.insert(key.clone(), item);
            }
        }
        if let Some(mapped) = row_to_field.get(*field) {
            all_data.insert(mapped.to_string(), data_map);
        }
    }

    let mut titles: Vec<String> = rows.iter().flat_map(|r| r.values.keys().cloned()).collect::<std::collections::HashSet<_>>().into_iter().collect();
    titles.sort();
    for row_title in titles {
        let Some(field_key) = row_to_field.get(row_title.as_str()).copied() else { continue };
        for (i, row) in rows.iter().enumerate() {
            let Some(stmt) = statements.get_mut(i) else { continue };
            let cell = row.values.get(&row_title).copied().flatten().map(|v| v.to_string()).unwrap_or_default();
            let base = base_for(&row_title);
            if DETAIL_KEYS.contains(&field_key) {
                let detail_map = all_data.get(field_key);
                let mut other = Map::new();
                if let Some(map) = detail_map {
                    let mut keys: Vec<&String> = map.keys().collect();
                    keys.sort();
                    for key in keys {
                        let per_period = map.get(key).and_then(|m| m.get(&rows[i].header)).map(|s| s.as_str());
                        other.insert((*key).clone(), json!(parse_number_data(per_period, base)));
                    }
                }
                stmt.insert(field_key.to_string(), json!({ "value": parse_number_data(Some(&cell), base), "other": other }));
            } else {
                stmt.insert(field_key.to_string(), json!(parse_number_data(Some(&cell), base)));
            }
        }
    }
    Ok(statements.into_iter().map(Value::Object).collect())
}

async fn get_peer_companies(snapshot: &CompanySnapshot, source: &Source) -> Result<Vec<Value>, DataError> {
    let text = source.get_text(&format!("/api/company/{}/peers", snapshot.warehouse_id), false).await?.text;
    let doc = scraper::Html::parse_document(&text);
    let row_sel = scraper::Selector::parse("table.data-table tbody tr[data-row-company-id]").unwrap();
    let td_sel = scraper::Selector::parse("td").unwrap();
    let a_sel = scraper::Selector::parse("a[href^='/company/']").unwrap();
    let mut peers = vec![];
    for tr in doc.select(&row_sel) {
        let columns: Vec<_> = tr.select(&td_sel).collect();
        if columns.len() < 11 {
            continue;
        }
        let cell = |i: usize| columns.get(i).map(|c| c.text().collect::<Vec<_>>().join(" ")).unwrap_or_default();
        let link = columns.get(1).and_then(|c| c.select(&a_sel).next());
        peers.push(json!({
            "symbol": link.and_then(|a| a.value().attr("href")).unwrap_or(""),
            "sector": snapshot.peer_sector,
            "name": link.map(|a| a.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or_default(),
            "currentPrice": parse_number_data(Some(&cell(2)), BaseValue::One),
            "stockPE": parse_number_data(Some(&cell(3)), BaseValue::Ratio),
            "marketCap": parse_number_data(Some(&cell(4)), BaseValue::Crore),
            "dividendYield": parse_number_data(Some(&cell(5)), BaseValue::Percent),
            "netProfitLatestQuarter": parse_number_data(Some(&cell(6)), BaseValue::Crore),
            "YOYQuarterlyProfitGrowth": parse_number_data(Some(&cell(7)), BaseValue::Percent),
            "salesLatestQuarter": parse_number_data(Some(&cell(8)), BaseValue::Crore),
            "YOYQuarterlySalesGrowth": parse_number_data(Some(&cell(9)), BaseValue::Percent),
            "ROCE": parse_number_data(Some(&cell(10)), BaseValue::Percent),
        }));
    }
    Ok(peers)
}

pub struct CompanyData {
    pub value: Value,
    #[allow(dead_code)]
    pub hit: bool,
    #[allow(dead_code)]
    pub snapshot_expires_at_ms: i64,
}

pub async fn get_company_data(provider: &Provider, endpoint: &str) -> Result<CompanyData, DataError> {
    let snapshot = provider.snapshot(endpoint).await?;
    let source = &provider.source;
    let ref_id = snapshot.ref_id.clone();
    let name = snapshot.name.clone();

    let mut summary = Map::new();
    for (label, amount) in &snapshot.summary {
        let value = amount.map(|v| v.to_string()).unwrap_or_default();
        let entry = match label.as_str() {
            "Market Cap" => Some(("marketCap", parse_number_data(Some(&value), BaseValue::Crore))),
            "Current Price" => Some(("currentPrice", parse_number_data(Some(&value), BaseValue::One))),
            "high52" => Some(("high", parse_number_data(Some(&value), BaseValue::One))),
            "low52" => Some(("low", parse_number_data(Some(&value), BaseValue::One))),
            "Stock P/E" => Some(("stockPE", parse_number_data(Some(&value), BaseValue::Ratio))),
            "Book Value" => Some(("bookValue", parse_number_data(Some(&value), BaseValue::One))),
            "Dividend Yield" => Some(("dividendYield", parse_number_data(Some(&value), BaseValue::Percent))),
            "ROCE" => Some(("roce", parse_number_data(Some(&value), BaseValue::Percent))),
            "ROE" => Some(("roe", parse_number_data(Some(&value), BaseValue::Percent))),
            "Face Value" => Some(("faceValue", parse_number_data(Some(&value), BaseValue::One))),
            _ => None,
        };
        if let Some((key, data)) = entry {
            summary.insert(key.to_string(), json!(data));
        }
    }
    summary.insert("pros".to_string(), json!(snapshot.analysis.pros));
    summary.insert("cons".to_string(), json!(snapshot.analysis.cons));

    let peer_companies = get_peer_companies(&snapshot, source).await?;

    let quarterly_map: HashMap<&str, &str> = [
        ("Sales", "sales"), ("Revenue", "sales"), ("Expenses", "expenses"), ("Operating Profit", "operatingProfit"),
        ("Financing Profit", "operatingProfit"), ("Financing Margin %", "OPM"), ("OPM %", "OPM"), ("Other Income", "otherIncome"),
        ("Interest", "interest"), ("Depreciation", "depreciation"), ("Profit before tax", "profitBeforeTax"), ("Tax %", "tax"),
        ("Net Profit", "netProfit"), ("EPS in Rs", "EPS"),
    ].into_iter().collect();
    let quarterly_details: std::collections::HashSet<&str> = ["Sales", "Expenses", "Other Income", "Net Profit"].into_iter().collect();

    let mut quarterly = extract_table(&snapshot, "#quarters", &quarterly_map, &quarterly_details, source).await?;
    for (i, url) in snapshot.quarterly_source_urls.iter().enumerate() {
        if let Some(Value::Object(stmt)) = quarterly.get_mut(i) {
            stmt.insert("sourceUrl".to_string(), Value::String(url.clone()));
        }
    }
    let profit_loss = extract_table(&snapshot, "#profit-loss", &quarterly_map, &quarterly_details, source).await?;

    let bs_map: HashMap<&str, &str> = [
        ("Equity Capital", "equityCapital"), ("Reserves", "reservers"), ("Borrowings", "borrowings"), ("Borrowing", "borrowings"),
        ("Other Liabilities", "otherLiabilities"), ("Total Liabilities", "totalLiabilities"), ("Fixed Assets", "fiexedAssets"),
        ("CWIP", "CWIP"), ("Investments", "investments"), ("Other Assets", "otherAssets"), ("Total Assets", "totalAssets"),
    ].into_iter().collect();
    let bs_details: std::collections::HashSet<&str> = ["Borrowings", "Other Liabilities", "Fixed Assets", "Other Assets"].into_iter().collect();
    let balance_sheet = extract_table(&snapshot, "#balance-sheet", &bs_map, &bs_details, source).await?;

    let cf_map: HashMap<&str, &str> = [
        ("Cash from Operating Activity", "operatingActivities"), ("Cash from Investing Activity", "investingActivities"),
        ("Cash from Financing Activity", "financingActivities"), ("Net Cash Flow", "netCashFlow"),
    ].into_iter().collect();
    let cf_details: std::collections::HashSet<&str> = ["Cash from Operating Activity", "Cash from Investing Activity", "Cash from Financing Activity"].into_iter().collect();
    let cash_flow = extract_table(&snapshot, "#cash-flow", &cf_map, &cf_details, source).await?;

    let ratio_map: HashMap<&str, &str> = [
        ("Debtor Days", "debtorDays"), ("Inventory Days", "inventoryDays"), ("Days Payable", "daysPayable"),
        ("Cash Conversion Cycle", "cashConversionCycle"), ("Working Capital Days", "workingCapitalTurnover"), ("ROCE %", "ROCE"),
    ].into_iter().collect();
    let ratio_details: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let ratio_statements = extract_table(&snapshot, "#ratios", &ratio_map, &ratio_details, source).await?;

    let shp_map: HashMap<&str, &str> = [
        ("Promoters", "promoters"), ("FIIs", "FIIS"), ("DIIs", "DIIS"), ("Government", "government"),
        ("Public", "public"), ("No. of Shareholders", "noOfShareHolders"),
    ].into_iter().collect();
    let shp_details: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let shareholding = extract_table(&snapshot, "#quarterly-shp", &shp_map, &shp_details, source).await?;

    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let value = json!({
        "refId": ref_id,
        "name": name,
        "url": snapshot.website.clone().unwrap_or_default(),
        "about": snapshot.about(),
        "keyPoints": snapshot.key_points,
        "timeStamp": timestamp,
        "skip": false,
        "summary": summary,
        "peerCompanies": peer_companies,
        "quarterlyResultStatements": quarterly,
        "profitAndLossStatements": profit_loss,
        "balanceSheetStatements": balance_sheet,
        "cashFlowStatements": cash_flow,
        "ratioStatements": ratio_statements,
        "shareholdingPatternStatements": shareholding,
        "metrics": [],
        "news": fetch_news(&name, source).await,
    });
    Ok(CompanyData { value, hit: false, snapshot_expires_at_ms: 0 })
}

async fn fetch_news(name: &str, _source: &Source) -> Value {
    // Best-effort with a short timeout: news never fails the request.
    let query: String = name.chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    let query = query.split_whitespace().collect::<Vec<_>>().join(" ");
    let url = format!("https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?query={}&type=3&format=json", urlencoding(&query));
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(4)).build();
    let Ok(client) = client else { return Value::Array(vec![]) };
    let Ok(response) = client.get(&url).send().await else { return Value::Array(vec![]) };
    let Ok(data) = response.json::<Value>().await else { return Value::Array(vec![]) };
    if data.is_array() {
        data
    } else {
        Value::Array(vec![])
    }
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

impl CompanySnapshot {
    fn about(&self) -> String {
        self.description.clone()
    }
}
