//! ScreenerProvider port: snapshot caching, dataset execution, financial
//! statement mapping and ownership/schedule enrichment.

use crate::{
    cache::{CacheHit, COMPANY_CACHE_TTL},
    error::{decode_error, encode_error, DataError},
    parse::*,
    source::Source,
};
use serde_json::{json, Map, Value};
use std::{collections::{HashMap, HashSet}, sync::Arc};
use tokio::sync::{Mutex, OnceCell};

// ---------------------------------------------------------------------------
// Statement mapping helpers (mirrors screener-provider.ts exactly)
// ---------------------------------------------------------------------------

const FINANCIAL_ROWS: &[&str] = &[
    "EPS", "adjustedEquityShareCapital", "adjustedFaceValue", "changesInInventories", "costOfMaterialsConsumed", "costofGoodsSold", "currentTax", "deferredTax", "depreciationAndAmortisation", "dilutedSharesOutstanding", "employeeBenefitExpense", "exceptionalItemsBeforeTax", "expenses", "extraordinaryItems", "financeCosts", "income", "nonControllingInterests", "otherExpenses", "otherIncome", "profitBeforeTax", "profitLossForEPS", "profitLossForPeriod", "profitOrLossAttributableToOwners", "profitOrLossOfAssociates", "purchasesOfStockInTrade", "revenueFromOperations", "taxExpense",
];
const BASIC_METRICS: &[&str] = &[
    "adjustedEquityShareCapital", "adjustedFaceValue", "costOfGoodsSold", "dilutedSharesOutstanding", "ebit", "ebitda", "grossIncome", "operatingExpenses", "operatingProfit", "operatingRevenue", "operatingMargin", "salesPerShare", "sharesOutstanding", "tax",
];
const RATIO_FIELDS: &[&str] = &[
    "dividendPayout", "ebitMargin", "ebitdaMargin", "effectiveTaxRate", "grossMargin", "netMargin", "operatingMargin", "preTaxMargin", "retentionRatio", "returnOnAsset", "returnOnCapital", "returnOnEquity", "returnOnTangibleAssets",
];
const OWNERSHIP_FIELDS: &[&str] = &[
    "convertibleSecWarrants", "dematEquityShares", "differentialVotingRights", "indianShareholders", "lockedInShares", "lockedInSharesPct", "outstandingConvertibleSecurities", "outstandingDepositoryRcpts", "pANShareholder", "paidUpEquityShares", "partlyPaidUpEquity", "pledgedShares", "pledgedSharesPct", "promoterShareholding", "sameClassVotingRights", "shareholdingPct", "shareholdingPctConv", "subCategory1Shares", "subCategory2Shares", "subCategory3Shares", "totalShareholders", "totalShares", "totalVotingRights", "totalVotingRightsPct", "warrants",
];
const OWNERSHIP_TEXT_FIELDS: &[&str] = &[
    "bankName", "categoryOrMoreThan1Pct", "foreignShareholders", "group", "institutions", "otherNonInstitutions", "sh_axis", "sh_index", "shareholder_name", "sub_group", "typeDepositoryRcpts",
];
const DISTRIBUTION_DATA_FIELDS: &[&str] = &[
    "dematEquityShares", "paidUpEquityShares", "sameClassVotingRights", "shareholdingPct", "shareholdingPctConv", "subCategory1Shares", "subCategory2Shares", "subCategory3Shares", "totalShareholders", "totalShares", "totalVotingRights", "totalVotingRightsPct",
];

fn nulls(names: &[&str]) -> Map<String, Value> {
    names.iter().map(|n| (n.to_string(), Value::Null)).collect()
}

fn pick(row: &FinancialRow, names: &[&str]) -> Option<f64> {
    names.iter().find_map(|n| row.values.get(*n).copied().flatten())
}

fn sum(vals: &[Option<f64>]) -> Option<f64> {
    let mut total = 0.0;
    for v in vals {
        total += (*v)?;
    }
    Some(total)
}

fn divide(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(x), Some(y)) if y != 0.0 => Some(x / y),
        _ => None,
    }
}

fn rupees(n: Option<f64>) -> Value {
    match n {
        Some(v) => json!(v * 10_000_000.0),
        None => Value::Null,
    }
}

fn year_of(header: &str) -> Value {
    for i in 0..header.len().saturating_sub(3) {
        let part = &header[i..i + 4];
        if part.starts_with("20") && part.parse::<i32>().is_ok() {
            return json!(part.parse::<i32>().unwrap());
        }
    }
    Value::Null
}

fn is_full_year(header: &str) -> bool {
    const MONTHS: &[&str] = &["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    header.len() == 8 && MONTHS.contains(&&header[..3]) && header[4..].starts_with("20") && header[4..].parse::<i32>().is_ok()
}

fn financials(snapshot: &CompanySnapshot, code: &str, period: &str) -> Result<Vec<Value>, DataError> {
    if !["pl", "bs", "cf"].contains(&code) {
        return Err(DataError::new("Invalid statement_code", 400, "INVALID_QUERY"));
    }
    if period == "halfyearly" || period == "ytd" || (period == "ttm" && code != "pl") || (period == "quarterly" && code != "pl") {
        return Err(DataError::dataset_unavailable("The current source does not provide this statement and period combination"));
    }
    let section = if code == "pl" {
        if period == "quarterly" { "quarters" } else { "profit-loss" }
    } else if code == "bs" {
        "balance-sheet"
    } else {
        "cash-flow"
    };
    let empty = vec![];
    let table = snapshot.tables.get(section).unwrap_or(&empty);
    let pl_table = snapshot.tables.get("profit-loss");
    let periods: HashSet<String> = pl_table
        .map(|t| t.iter().filter(|r| is_full_year(&r.header)).map(|r| r.header.clone()).collect())
        .unwrap_or_default();
    let rows: Vec<&FinancialRow> = if period == "ttm" {
        table.iter().filter(|r| r.header == "TTM").collect()
    } else if period == "annual" {
        table.iter().filter(|r| is_full_year(&r.header) && (section == "profit-loss" || periods.contains(&r.header))).collect()
    } else {
        table.iter().collect()
    };
    let mut out = vec![];
    for row in rows {
        let mut meta = Map::new();
        meta.insert("header".to_string(), Value::String(row.header.clone()));
        meta.insert("year".to_string(), year_of(&row.header));
        if code == "pl" {
            let revenue = pick(row, &["Sales", "Revenue"]);
            let other = pick(row, &["Other Income"]);
            let ebit = sum(&[pick(row, &["Profit before tax"]), pick(row, &["Interest"])]);
            let mut blank = nulls(FINANCIAL_ROWS);
            blank.append(&mut nulls(BASIC_METRICS));
            blank.insert("header".to_string(), Value::String(row.header.clone()));
            blank.insert("year".to_string(), year_of(&row.header));
            blank.insert("revenueFromOperations".to_string(), rupees(revenue));
            blank.insert("otherIncome".to_string(), rupees(other));
            blank.insert("income".to_string(), rupees(sum(&[revenue, other])));
            blank.insert("expenses".to_string(), rupees(sum(&[pick(row, &["Expenses"]), pick(row, &["Interest"]), pick(row, &["Depreciation"])])));
            blank.insert("financeCosts".to_string(), rupees(pick(row, &["Interest"])));
            blank.insert("depreciationAndAmortisation".to_string(), rupees(pick(row, &["Depreciation"])));
            blank.insert("profitBeforeTax".to_string(), rupees(pick(row, &["Profit before tax"])));
            blank.insert("profitLossForPeriod".to_string(), rupees(pick(row, &["Net Profit"])));
            blank.insert("EPS".to_string(), match pick(row, &["EPS in Rs"]) { Some(v) => json!(v), None => Value::Null });
            blank.insert("ebit".to_string(), rupees(ebit));
            blank.insert("ebitda".to_string(), rupees(sum(&[ebit, pick(row, &["Depreciation"])])));
            blank.insert("operatingProfit".to_string(), rupees(pick(row, &["Operating Profit", "Financing Profit"])));
            blank.insert("operatingRevenue".to_string(), rupees(revenue));
            blank.insert("operatingMargin".to_string(), match divide(pick(row, &["OPM %", "Financing Margin %"]), Some(100.0)) { Some(v) => json!(v), None => Value::Null });
            blank.insert("tax".to_string(), match divide(pick(row, &["Tax %"]), Some(100.0)) { Some(v) => json!(v), None => Value::Null });
            out.push(Value::Object(blank));
        } else if code == "bs" {
            let equity = sum(&[pick(row, &["Equity Capital"]), pick(row, &["Reserves"])]);
            let mut obj = Map::new();
            obj.insert("header".to_string(), Value::String(row.header.clone()));
            obj.insert("year".to_string(), year_of(&row.header));
            obj.insert("totalEquity".to_string(), rupees(equity));
            obj.insert("equityCapital".to_string(), rupees(pick(row, &["Equity Capital"])));
            obj.insert("reserves".to_string(), rupees(pick(row, &["Reserves"])));
            obj.insert("liabilities".to_string(), rupees(sum(&[pick(row, &["Borrowings", "Borrowing"]), pick(row, &["Other Liabilities"])])));
            obj.insert("equityAndLiabilities".to_string(), rupees(pick(row, &["Total Liabilities"])));
            obj.insert("assets".to_string(), rupees(pick(row, &["Total Assets"])));
            obj.insert("capitalWorkInProgress".to_string(), rupees(pick(row, &["CWIP"])));
            obj.insert("fixedAssets".to_string(), rupees(pick(row, &["Fixed Assets"])));
            obj.insert("investments".to_string(), rupees(pick(row, &["Investments"])));
            obj.insert("otherAssets".to_string(), rupees(pick(row, &["Other Assets"])));
            obj.insert("inventories".to_string(), rupees(pick(row, &["Inventories"])));
            obj.insert("tradeReceivables".to_string(), rupees(pick(row, &["Trade receivables"])));
            obj.insert("cashAndCashEquivalents".to_string(), rupees(pick(row, &["Cash Equivalents"])));
            obj.insert("tradePayables".to_string(), rupees(pick(row, &["Trade Payables"])));
            obj.insert("longTermBorrowings".to_string(), rupees(pick(row, &["Long term Borrowings"])));
            obj.insert("shortTermBorrowings".to_string(), rupees(pick(row, &["Short term Borrowings"])));
            for k in ["currentAssets", "noncurrentAssets", "currentLiabilities", "noncurrentLiabilities"] {
                obj.insert(k.to_string(), Value::Null);
            }
            let _ = meta;
            out.push(Value::Object(obj));
        } else {
            let mut obj = Map::new();
            obj.insert("header".to_string(), Value::String(row.header.clone()));
            obj.insert("year".to_string(), year_of(&row.header));
            obj.insert("cashFlowsFromOperatingActivities".to_string(), rupees(pick(row, &["Cash from Operating Activity"])));
            obj.insert("cashFlowsFromInvestingActivities".to_string(), rupees(pick(row, &["Cash from Investing Activity"])));
            obj.insert("cashFlowsFromFinancingActivities".to_string(), rupees(pick(row, &["Cash from Financing Activity"])));
            obj.insert("netCashFlow".to_string(), rupees(pick(row, &["Net Cash Flow"])));
            obj.insert("freeCashFlow".to_string(), rupees(pick(row, &["Free Cash Flow"])));
            let _ = meta;
            out.push(Value::Object(obj));
        }
    }
    Ok(out)
}

fn ratios(snapshot: &CompanySnapshot) -> Result<Vec<Value>, DataError> {
    let empty = vec![];
    let pl = snapshot.tables.get("profit-loss").unwrap_or(&empty);
    let bs = snapshot.tables.get("balance-sheet").unwrap_or(&empty);
    let ratio_table = snapshot.tables.get("ratios").unwrap_or(&empty);
    let mut out = vec![];
    for row in pl.iter().filter(|r| is_full_year(&r.header)) {
        let revenue = pick(row, &["Sales", "Revenue"]);
        let op = pick(row, &["Operating Profit", "Financing Profit"]);
        let pbt = pick(row, &["Profit before tax"]);
        let interest = pick(row, &["Interest"]);
        let net = pick(row, &["Net Profit"]);
        let ebit = sum(&[pbt, interest]);
        let income = sum(&[revenue, pick(row, &["Other Income"])]);
        let dividend = divide(pick(row, &["Dividend Payout %"]), Some(100.0));
        let y = year_of(&row.header).as_i64();
        let prefix = row.header.get(..3).unwrap_or("");
        let current = bs.iter().find(|r| r.header == row.header);
        let previous = bs.iter().find(|r| {
            year_of(&r.header).as_i64() == y.map(|v| v - 1) && r.header.get(..3).unwrap_or("") == prefix
        });
        let total_assets = |r: Option<&FinancialRow>| r.and_then(|r| pick(r, &["Total Assets"]));
        // Average equity only when both periods exist (a missing pick nulls it).
        let eq_sum = |r: Option<&FinancialRow>| -> Option<f64> {
            let r = r?;
            sum(&[pick(r, &["Equity Capital"]), pick(r, &["Reserves"])])
        };
        let avg_assets = match (total_assets(current), total_assets(previous)) {
            (Some(a), Some(b)) => divide(Some(a + b), Some(2.0)),
            _ => None,
        };
        let avg_equity = match (eq_sum(current), eq_sum(previous)) {
            (Some(a), Some(b)) => divide(Some(a + b), Some(2.0)),
            _ => None,
        };
        let ratio_row = ratio_table.iter().find(|r| r.header == row.header);
        let mut obj = nulls(RATIO_FIELDS);
        let num = |v: Option<f64>| v.map(|x| json!(x)).unwrap_or(Value::Null);
        obj.insert("header".to_string(), Value::String(row.header.clone()));
        obj.insert("year".to_string(), year_of(&row.header));
        obj.insert("dividendPayout".to_string(), num(dividend));
        obj.insert("retentionRatio".to_string(), num(dividend.map(|d| 1.0 - d)));
        obj.insert("ebitMargin".to_string(), num(divide(ebit, revenue)));
        obj.insert("ebitdaMargin".to_string(), num(divide(sum(&[ebit, pick(row, &["Depreciation"])]), revenue)));
        obj.insert("effectiveTaxRate".to_string(), num(divide(pick(row, &["Tax %"]), Some(100.0))));
        obj.insert("netMargin".to_string(), num(divide(net, revenue)));
        obj.insert("operatingMargin".to_string(), num(divide(op, revenue)));
        obj.insert("preTaxMargin".to_string(), num(divide(pbt, income)));
        obj.insert("returnOnAsset".to_string(), num(divide(net, avg_assets)));
        obj.insert("returnOnEquity".to_string(), num(divide(net, avg_equity)));
        obj.insert("returnOnCapital".to_string(), num(ratio_row.and_then(|r| pick(r, &["ROCE %"])).and_then(|v| divide(Some(v), Some(100.0)))));
        out.push(Value::Object(obj));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type SharedHtml = Arc<OnceCell<Result<String, DataError>>>;

#[derive(Clone)]
pub struct Provider {
    pub source: Source,
    pending: Arc<Mutex<HashMap<String, SharedHtml>>>,
}

#[derive(Debug, Clone)]
pub struct DataResult {
    pub body: Value,
    pub headers: HashMap<String, String>,
}

impl Provider {
    pub fn new(source: Source) -> Self {
        Self { source, pending: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Raw upstream HTML with in-process coalescing (max 8 concurrent loads).
    /// Company pages bypass the shared response cache; everything else shares it.
    pub async fn html(&self, path: &str, ajax: bool) -> Result<String, DataError> {
        let key = format!("{}:{path}", if ajax { "ajax" } else { "html" });
        let cell = {
            let mut pending = self.pending.lock().await;
            if pending.len() >= 8 && !pending.contains_key(&key) {
                return Err(DataError::new("Source capacity reached; retry later", 503, "SOURCE_BUSY"));
            }
            pending.entry(key.clone()).or_insert_with(|| Arc::new(OnceCell::new())).clone()
        };
        let source = self.source.clone();
        let path_owned = path.to_string();
        let result = cell
            .get_or_init(|| async {
                let url = source.url(&path_owned)?;
                let company_page = valid_company_path(url.path());
                if company_page {
                    // Company pages are cached as parsed snapshots, never raw.
                    match source.fetch_raw(&path_owned, ajax).await {
                        Ok((text, final_url, _)) => {
                            if path_owned.contains("/consolidated/") && !url_path(&final_url).contains("/consolidated/") {
                                return Err(DataError::new("Consolidated company statements are unavailable", 404, "NOT_FOUND"));
                            }
                            Ok(text)
                        }
                        Err(e) => Err(e),
                    }
                } else {
                    Ok(source.get_text(&path_owned, ajax).await?.text)
                }
            })
            .await;
        {
            let mut pending = self.pending.lock().await;
            if let Some(existing) = pending.get(&key) {
                if Arc::ptr_eq(existing, &cell) {
                    pending.remove(&key);
                }
            }
        }
        result.clone()
    }

    async fn detail_rows(&self, path: &str) -> Result<Map<String, Value>, DataError> {
        match self.source.get_json(path).await? {
            Value::Object(map) => Ok(map),
            _ => Err(DataError::new("Source detail row format changed", 502, "UPSTREAM_SCHEMA_CHANGED")),
        }
    }

    async fn expand_schedules(&self, snapshot: &mut CompanySnapshot, section: &str, parents: &[&str]) -> Result<(), DataError> {
        for parent in parents {
            let present = snapshot.tables.get(section).map(|t| t.iter().any(|r| r.values.contains_key(*parent))).unwrap_or(false);
            if !present {
                continue;
            }
            let mut url = format!("/api/company/{}/schedules/?parent={parent}&section={section}", snapshot.ref_id);
            if snapshot.consolidated {
                url.push_str("&consolidated=true");
            }
            let details = self.detail_rows(&url).await?;
            for (label, data) in &details {
                if let Value::Object(data) = data {
                    if let Some(table) = snapshot.tables.get_mut(section) {
                        for row in table.iter_mut() {
                            if let Some(Value::String(s)) = data.get(&row.header) {
                                row.values.insert(label.clone(), numeric_value(s));
                            }
                        }
                    }
                }
            }
            // Pacing for uncached detail fetches happens in company.rs via hit flags;
            // here the shared text cache reports hits through get_text internally.
        }
        Ok(())
    }

    async fn owners(&self, snapshot: &CompanySnapshot, period: &str) -> Result<(Vec<FinancialRow>, Vec<OwnerEntry>), DataError> {
        let source_period = if period == "annual" { "yearly" } else { "quarterly" };
        let table_key = format!("{source_period}-shp");
        let table = snapshot.tables.get(&table_key).cloned().unwrap_or_default();
        let groups = [("Promoters", "promoters"), ("FIIs", "foreign_institutions"), ("DIIs", "domestic_institutions"), ("Government", "government"), ("Public", "public")];
        let mut result = vec![];
        for (group, code) in groups {
            if !table.iter().any(|r| r.values.contains_key(group)) {
                continue;
            }
            let details = self.detail_rows(&format!("/api/3/{}/investors/{code}/{source_period}/", snapshot.ref_id)).await?;
            for (name, data) in &details {
                if let Value::Object(data) = data {
                    let mut row_data = Map::new();
                    for r in &table {
                        let v = match data.get(&r.header) {
                            Some(Value::String(s)) => numeric_value(s).map(|x| json!(x)).unwrap_or(Value::Null),
                            _ => Value::Null,
                        };
                        row_data.insert(r.header.clone(), v);
                    }
                    result.push(OwnerEntry { group: group.to_string(), name: name.clone(), data: row_data });
                }
            }
        }
        Ok((table, result))
    }

    pub async fn snapshot(&self, symbol: &str) -> Result<CompanySnapshot, DataError> {
        let path = if symbol.ends_with('/') { symbol.to_string() } else { format!("{symbol}/") };
        if !valid_company_path(&path) {
            return Err(DataError::new("symbol must be a company URL path", 400, "INVALID_QUERY"));
        }
        let consolidated = path.contains("/consolidated/");
        let url = self.source.url(&path)?;
        let key = self.source.cache_key("company", &url);
        let source = self.source.clone();
        let path_owned = path.clone();
        let load = || async {
            let html = self.html(&path_owned, false).await.map_err(|e| encode_error(&e))?;
            parse_company_snapshot(&html, &path_owned, consolidated)
                .map_err(|m| {
                    if m == "Source did not return a company page" {
                        encode_error(&DataError::new("Company or source resource not found", 404, "NOT_FOUND"))
                    } else {
                        encode_error(&DataError::new("Source company page could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"))
                    }
                })
                .and_then(|snapshot| serde_json::to_value(&snapshot).map_err(|e| e.to_string()))
        };
        // Enrichments mutate financial rows; never let them modify the cache.
        // Deserializing per request gives each caller an owned copy.
        let cached: Option<CacheHit> = match &source.cache {
            Some(cache) => cache.remember(&key, COMPANY_CACHE_TTL, load, None).await.map(Some).map_err(|message| decode_error(&message))?,
            None => None,
        };
        let value = match cached {
            Some(hit) => hit.value,
            None => load().await.map_err(|message| decode_error(&message))?,
        };
        let mut snapshot: CompanySnapshot = serde_json::from_value(value).map_err(|_| DataError::new("Source company page could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"))?;
        snapshot.symbol = symbol.to_string();
        Ok(snapshot)
    }

    fn paged(&self, body: Value, html: &str, page: i64) -> DataResult {
        let next = next_page(html, page);
        DataResult {
            body,
            headers: [
                ("X-Page".to_string(), page.to_string()),
                ("X-Next-Page".to_string(), next.map(|n| n.to_string()).unwrap_or_default()),
                ("X-Data-Coverage".to_string(), "partial".to_string()),
            ]
            .into_iter()
            .collect(),
        }
    }

    pub async fn execute(&self, resource: &str, query: &HashMap<String, String>) -> Result<DataResult, DataError> {
        let page: i64 = query.get("page").and_then(|p| p.parse().ok()).unwrap_or(1);
        let symbol = query.get("symbol").cloned();
        let within = |date: &Option<String>| {
            let after_from = match query.get("from_date") {
                Some(from) => date.as_ref().map(|d| d >= from).unwrap_or(false),
                None => true,
            };
            let before_to = match query.get("to_date") {
                Some(to) => date.as_ref().map(|d| d <= to).unwrap_or(false),
                None => true,
            };
            after_from && before_to
        };
        if resource == "corporate-actions/all" {
            if let Some(action) = query.get("action") {
                if !["bonus", "split", "rights", "dividend"].contains(&action.to_lowercase().as_str()) {
                    return Err(DataError::new("action must be bonus, split, rights or dividend", 400, "INVALID_QUERY"));
                }
            }
        }
        if resource == "results-calendar" {
            let html = self.html(&format!("/upcoming-results/?p={page}"), false).await?;
            let rows: Vec<Value> = parse_admin_rows(&html)
                .map_err(|m| DataError::new(m, 502, "UPSTREAM_SCHEMA_CHANGED"))?
                .iter()
                .map(|r| {
                    json!({
                        "symbol": r.symbol,
                        "company_name": r.name,
                        "expected_result_date": r.fields.get("result_date").and_then(|d| source_date(d)),
                    })
                })
                .filter(|v| within(&v.get("expected_result_date").and_then(|d| d.as_str()).map(|s| s.to_string())))
                .collect();
            return Ok(self.paged(Value::Array(rows), &html, page));
        }
        if resource == "corporate-actions/all" && symbol.is_none() {
            let kinds: Vec<String> = match query.get("action") {
                Some(a) => vec![a.to_lowercase()],
                None => ["bonus", "split", "rights", "dividend"].iter().map(|s| s.to_string()).collect(),
            };
            let mut rows: Vec<Value> = vec![];
            let mut next: Option<i64> = None;
            for kind in &kinds {
                let slug = if kind == "rights" { "right" } else { kind };
                let html = self.html(&format!("/actions/{slug}/?o=-1&p={page}"), false).await?;
                next = match (next, next_page(&html, page)) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (Some(a), None) => Some(a),
                    (None, b) => b,
                };
                for row in parse_admin_rows(&html).map_err(|m| DataError::new(m, 502, "UPSTREAM_SCHEMA_CHANGED"))? {
                    let date = row.fields.get("ex_date").and_then(|d| source_date(d));
                    if !within(&date) {
                        continue;
                    }
                    let subject = if kind == "dividend" {
                        Some(format!("{}: {}% of face value", row.fields.get("div_type").map(|s| s.as_str()).unwrap_or("Dividend"), row.fields.get("percent").map(|s| s.as_str()).unwrap_or("unknown")))
                    } else {
                        row.fields.get("ratio").cloned().or_else(|| {
                            row.fields.get("new_fv").map(|fv| format!("New face value: {fv}"))
                        })
                    };
                    rows.push(json!({
                        "symbol": row.symbol,
                        "action": kind,
                        "ex_date": date,
                        "amount": Value::Null,
                        "adj_amount": Value::Null,
                        "dividend_type": row.fields.get("div_type"),
                        "subject": subject,
                        "timestamp_unix": Value::Null,
                    }));
                }
            }
            let mut headers = HashMap::new();
            headers.insert("X-Page".to_string(), page.to_string());
            headers.insert("X-Next-Page".to_string(), next.map(|n| n.to_string()).unwrap_or_default());
            return Ok(DataResult { body: Value::Array(rows), headers });
        }
        let symbol = symbol.ok_or_else(|| DataError::dataset_unavailable("The current source requires symbol for this dataset"))?;
        let mut snapshot = self.snapshot(&symbol).await?;
        let body: Value = if resource == "company-profile" {
            let mut obj = Map::new();
            obj.insert("symbol".to_string(), Value::String(symbol.clone()));
            obj.insert("name".to_string(), Value::String(snapshot.name.clone()));
            obj.insert("bse_code".to_string(), snapshot.bse_code.clone().map(Value::String).unwrap_or(Value::Null));
            obj.insert("nse_code".to_string(), snapshot.nse_code.clone().map(Value::String).unwrap_or(Value::Null));
            obj.insert("description".to_string(), Value::String(snapshot.description.clone()));
            obj.insert("website".to_string(), snapshot.website.clone().map(Value::String).unwrap_or(Value::Null));
            obj.insert("market_cap".to_string(), snapshot.summary.get("Market Cap").copied().flatten().map(|v| json!(v)).unwrap_or(Value::Null));
            for g in ["macro_sector", "industry", "sector", "sub_industry"] {
                obj.insert(g.to_string(), snapshot.classifications.get(g).map(|c| Value::String(c.name.clone())).unwrap_or(Value::Null));
            }
            Value::Object(obj)
        } else if ["quarterly-profit-loss", "profit-loss", "balance-sheet", "cash-flow"].contains(&resource) {
            let code = if resource == "balance-sheet" { "bs" } else if resource == "cash-flow" { "cf" } else { "pl" };
            if code == "bs" {
                self.expand_schedules(&mut snapshot, "balance-sheet", &["Other Assets", "Other Liabilities", "Borrowings"]).await?;
            }
            let mut rows = financials(&snapshot, code, if resource == "quarterly-profit-loss" { "quarterly" } else { "annual" })?;
            if resource == "profit-loss" {
                rows.extend(financials(&snapshot, "pl", "ttm")?);
            }
            json!({ "symbol": symbol, "financials": rows })
        } else if resource == "ratios" {
            json!({ "symbol": symbol, "ratios": ratios(&snapshot)?, "metrics": snapshot.tables.get("ratios").cloned().unwrap_or_default() })
        } else if resource == "basic-financials" {
            let mut summary_map = Map::new();
            for (k, v) in &snapshot.summary {
                summary_map.insert(k.clone(), v.map(|x| json!(x)).unwrap_or(Value::Null));
            }
            json!({
                "symbol": symbol,
                "summary": summary_map,
                "about": snapshot.description,
                "keyPoints": snapshot.key_points,
                "basicFinance": {
                    "change": snapshot.change,
                    "high52": snapshot.summary.get("high52").copied().flatten().map(|v| json!(v)).unwrap_or(Value::Null),
                    "low52": snapshot.summary.get("low52").copied().flatten().map(|v| json!(v)).unwrap_or(Value::Null),
                    "market_cap": snapshot.summary.get("Market Cap").copied().flatten().map(|v| json!(v)).unwrap_or(Value::Null),
                    "price": snapshot.summary.get("Current Price").copied().flatten().map(|v| json!(v)).unwrap_or(Value::Null),
                    "shares": Value::Null,
                    "tradetime": Value::Null,
                    "volume": Value::Null,
                },
                "analysis": snapshot.analysis,
            })
        } else if resource == "company-documents" {
            let groups = [("annualReports", "report"), ("announcements", "announcement"), ("creditRatings", "credit-rating"), ("callTranscripts", "transcript"), ("presentations", "presentation"), ("other", "other")];
            let mut docs = Map::new();
            for (group, kind) in groups {
                let entries: Vec<Value> = snapshot
                    .documents
                    .iter()
                    .filter(|d| d.kind == kind)
                    .map(|d| json!({ "title": d.title, "url": d.url, "date": d.date, "year": d.year }))
                    .collect();
                docs.insert(group.to_string(), Value::Array(entries));
            }
            json!({ "symbol": symbol, "documents": docs })
        } else if resource == "peer-comparison" {
            let html = self.html(&format!("/api/company/{}/peers", snapshot.warehouse_id), true).await?;
            let peers = parse_peer_comparison(&html).map_err(|_| DataError::new("Peer comparison could not be parsed", 502, "UPSTREAM_SCHEMA_CHANGED"))?;
            json!({ "symbol": symbol, "peers": peers })
        } else if resource == "shareholding-pattern" {
            let (selected, owners) = self.owners(&snapshot, "quarterly").await?;
            // Insertion order across rows, like [...new Set(rows.flatMap(keys))].
            let mut seen = std::collections::HashSet::new();
            let mut groups: Vec<String> = vec![];
            for r in &selected {
                for g in r.values.keys() {
                    if g != "No. of Shareholders" && seen.insert(g.clone()) {
                        groups.push(g.clone());
                    }
                }
            }
            let rows: Vec<Value> = groups
                .iter()
                .map(|name| {
                    let shareholders: Vec<Value> = owners
                        .iter()
                        .filter(|o| &o.group == name)
                        .map(|o| json!({ "name": o.name, "data": o.data }))
                        .collect();
                    let mut data = Map::new();
                    for r in &selected {
                        data.insert(r.header.clone(), r.values.get(name).copied().flatten().map(|v| json!(v)).unwrap_or(Value::Null));
                    }
                    json!({ "name": name, "catagory": Value::Null, "shareholders": shareholders, "data": data })
                })
                .collect();
            json!({ "stock_symbol": symbol, "company_name": snapshot.name, "status": "Success",
                "columns": selected.iter().map(|r| Value::String(r.header.clone())).collect::<Vec<_>>(), "rows": rows })
        } else if ["shareholdings/ownership-current", "shareholdings/ownership-history"].contains(&resource) {
            let period = query.get("period").cloned().unwrap_or_else(|| "quarterly".to_string());
            let (table, owners) = self.owners(&snapshot, &period).await?;
            let row_for = |header: &str| -> Vec<Value> {
                owners
                    .iter()
                    .filter(|o| o.data.get(header).and_then(|v| v.as_f64()).is_some())
                    .map(|o| {
                        let mut obj = nulls(OWNERSHIP_FIELDS);
                        for f in OWNERSHIP_TEXT_FIELDS {
                            obj.insert(f.to_string(), Value::Null);
                        }
                        obj.insert("shareholder_name".to_string(), Value::String(o.name.clone()));
                        obj.insert("group".to_string(), Value::String(o.group.clone()));
                        obj.insert("shareholdingPct".to_string(), o.data.get(header).cloned().unwrap_or(Value::Null));
                        Value::Object(obj)
                    })
                    .collect()
            };
            if resource == "shareholdings/ownership-current" {
                let quarter = table.last().map(|r| r.header.clone());
                let ownerships = quarter.as_ref().map(|q| row_for(q)).unwrap_or_default();
                json!({ "symbol": symbol, "quarter": quarter, "ownerships": ownerships })
            } else {
                json!({ "symbol": symbol, "period": query.get("period"),
                    "ownership_histories": table.iter().map(|r| json!({ "header": r.header, "data": row_for(&r.header) })).collect::<Vec<_>>() })
            }
        } else if ["shareholdings/summary", "shareholdings/distribution"].contains(&resource) {
            let period = if resource == "shareholdings/distribution" { "quarterly".to_string() } else { query.get("period").cloned().unwrap_or_else(|| "quarterly".to_string()) };
            let table_key = if period == "annual" { "yearly-shp" } else { "quarterly-shp" };
            let rows = snapshot.tables.get(&table_key as &str).cloned().unwrap_or_default();
            if resource == "shareholdings/summary" {
                json!({ "symbol": symbol, "period": query.get("period"),
                    "summary": rows.iter().map(|r| {
                        let mut obj = nulls(OWNERSHIP_FIELDS);
                        obj.insert("header".to_string(), Value::String(r.header.clone()));
                        obj.insert("totalShareholders".to_string(), pick(r, &["No. of Shareholders"]).map(|v| json!(v)).unwrap_or(Value::Null));
                        obj.insert("promoterShareholding".to_string(), pick(r, &["Promoters"]).map(|v| json!(v)).unwrap_or(Value::Null));
                        Value::Object(obj)
                    }).collect::<Vec<_>>() })
            } else {
                json!({ "symbol": symbol, "period": period,
                    "distributions": rows.iter().map(|r| {
                        json!({ "date_header": r.header,
                            "distributions": r.values.iter().filter(|(g, _)| *g != "No. of Shareholders").map(|(group, v)| {
                                let mut data = nulls(DISTRIBUTION_DATA_FIELDS);
                                data.insert("shareholdingPct".to_string(), v.map(|x| json!(x)).unwrap_or(Value::Null));
                                json!({ "group": group, "data": data })
                            }).collect::<Vec<_>>() })
                    }).collect::<Vec<_>>() })
            }
        } else if ["corporate-actions", "corporate-actions/all", "dividend"].contains(&resource) {
            let action_filter = query.get("action").cloned();
            let include_rights = resource != "dividend" && action_filter.as_deref().map(|a| a != "rights").unwrap_or(true);
            if page != 1 && !include_rights {
                return Err(DataError::dataset_unavailable("The company action modal does not have a page cursor"));
            }
            let modal: Vec<CorpAction> = if page == 1 && action_filter.as_deref() != Some("rights") {
                parse_corporate_actions(&self.html(&format!("/company/actions/{}/", snapshot.ref_id), true).await?)
                    .map_err(|m| DataError::new(m, 502, "UPSTREAM_SCHEMA_CHANGED"))?
            } else {
                vec![]
            };
            if resource == "dividend" {
                let dividend: Vec<Value> = modal
                    .iter()
                    .filter(|a| a.kind == "dividend")
                    .map(|a| {
                        json!({ "date": a.date, "amount": numeric_value(&a.title).map(|v| json!(v)).unwrap_or(Value::Null),
                            "adj_amount": Value::Null,
                            "dividend_type": a.description.split(" - ").next().filter(|s| !s.is_empty()),
                            "subject": if a.description.is_empty() { Value::Null } else { Value::String(a.description.clone()) } })
                    })
                    .collect();
                json!({ "symbol": symbol, "dividend": dividend })
            } else {
                let mut rows: Vec<Value> = modal
                    .iter()
                    .filter(|a| !["equityhistory", "esops", "rights"].contains(&a.kind.as_str())
                        && action_filter.as_ref().map(|f| &a.kind == f).unwrap_or(true)
                        && within(&a.date))
                    .map(|a| {
                        let mut subject_parts = vec![];
                        if !a.title.is_empty() {
                            subject_parts.push(a.title.clone());
                        }
                        if !a.description.is_empty() {
                            subject_parts.push(a.description.clone());
                        }
                        let subject = subject_parts.join("; ");
                        json!({ "symbol": symbol, "action": a.kind, "ex_date": a.date,
                            "amount": if a.kind == "dividend" { numeric_value(&a.title).map(|v| json!(v)).unwrap_or(Value::Null) } else { Value::Null },
                            "adj_amount": Value::Null,
                            "dividend_type": if a.kind == "dividend" { Value::String(a.description.split(" - ").next().unwrap_or("").to_string()) } else { Value::Null },
                            "subject": if subject.is_empty() { Value::Null } else { Value::String(subject) },
                            "timestamp_unix": Value::Null })
                    })
                    .collect();
                if include_rights {
                    let base_name = snapshot.name.trim_end_matches("Ltd.").trim_end_matches("Ltd").trim();
                    let html = self.html(&format!("/actions/right/?o=-1&p={page}&q={}", urlencoding(&base_name)), false).await?;
                    let normalize = |p: &str| {
                        let p = p.strip_suffix("/consolidated/").or_else(|| p.strip_suffix("/consolidated")).unwrap_or(p);
                        p.strip_suffix('/').unwrap_or(p).to_uppercase()
                    };
                    let company_paths: Vec<String> = [
                        symbol.clone(),
                        format!("/company/id/{}/", snapshot.ref_id),
                        snapshot.nse_code.clone().map(|c| format!("/company/{c}/")).unwrap_or_default(),
                        snapshot.bse_code.clone().map(|c| format!("/company/{c}/")).unwrap_or_default(),
                    ]
                    .into_iter()
                    .filter(|s| !s.is_empty())
                    .map(|s| normalize(&s))
                    .collect();
                    for row in parse_admin_rows(&html).map_err(|m| DataError::new(m, 502, "UPSTREAM_SCHEMA_CHANGED"))? {
                        let date = row.fields.get("ex_date").and_then(|d| source_date(d));
                        if let Some(sym) = &row.symbol {
                            if company_paths.contains(&normalize(sym)) && within(&date) {
                                rows.push(json!({ "symbol": symbol, "action": "rights", "ex_date": date,
                                    "amount": Value::Null, "adj_amount": Value::Null, "dividend_type": Value::Null,
                                    "subject": row.fields.get("ratio"), "timestamp_unix": Value::Null }));
                            }
                        }
                    }
                    if resource == "corporate-actions/all" {
                        return Ok(self.paged(Value::Array(rows), &html, page));
                    }
                    return Ok(self.paged(json!({ "symbol": symbol, "actions": rows }), &html, page));
                }
                if resource == "corporate-actions/all" {
                    Value::Array(rows)
                } else {
                    json!({ "symbol": symbol, "actions": rows })
                }
            }
        } else {
            return Err(DataError::dataset_unavailable("The connected sources do not supply this dataset"));
        };
        Ok(DataResult { body, headers: [("X-Data-Coverage".to_string(), "partial".to_string())].into_iter().collect() })
    }
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

fn url_path(url: &str) -> String {
    url::Url::parse(url).map(|u| u.path().to_string()).unwrap_or_default()
}

#[derive(Debug, Clone)]
struct OwnerEntry {
    group: String,
    name: String,
    data: Map<String, Value>,
}
