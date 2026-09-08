use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::{interval, sleep, Duration};

use crate::ares_utils::http_connection::HttpConnection;
use crate::types::ReqRes;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct FuzzTarget {
    pub id: String,
    #[serde(default)]
    pub sort_order: usize,
    pub request: String,
    #[serde(default)]
    pub payload: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerRequestRow {
    pub id: usize,
    pub fuzz_request_id: String,
    #[serde(default)]
    pub raw_request: Option<String>,
    pub payload: Option<String>,
    pub response: Option<ReqRes>,
    pub request_date: String,
    pub status: String,
    pub error_message: Option<String>,
    pub connection_dropped: bool,
    pub worker_id: Option<u32>,
    pub status_code: Option<u16>,
    pub response_length: Option<usize>,
    pub response_time_ms: Option<u128>,
    pub chunk_id: Option<i64>,
    pub chunk_index: Option<i64>,
}

#[derive(Debug)]
pub struct FuzzerRunData {
    pub rows: Vec<FuzzerRequestRow>,
    pub id_map: HashMap<String, usize>,
    pub config_snapshot: Option<crate::types::SessionPayload>,
}

static FUZZ_STORE: OnceLock<Mutex<HashMap<String, FuzzerRunData>>> = OnceLock::new();

fn fuzz_store() -> &'static Mutex<HashMap<String, FuzzerRunData>> {
    FUZZ_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone)]
struct CachedSearch {
    key: String,
    rows: Vec<FuzzerRequestRow>,
    seen_ids: std::collections::HashSet<String>,
    last_scanned_date: i64,
    #[allow(dead_code)]
    last_accessed: std::time::Instant,
}

static SEARCH_CACHE: OnceLock<Mutex<VecDeque<CachedSearch>>> = OnceLock::new();

fn search_cache() -> &'static Mutex<VecDeque<CachedSearch>> {
    SEARCH_CACHE.get_or_init(|| Mutex::new(VecDeque::with_capacity(10)))
}

pub async fn invalidate_fuzzer_search_cache(session: u32, history: u32) {
    let prefix = format!("{}:{}:", session, history);
    let mut cache = search_cache().lock().await;
    cache.retain(|item| !item.key.starts_with(&prefix));
}

struct ActiveSearchInfo {
    query: String,
    flag: Arc<AtomicBool>,
}

static SEARCH_CANCELLATIONS: OnceLock<Mutex<HashMap<String, ActiveSearchInfo>>> = OnceLock::new();

fn search_cancellations() -> &'static Mutex<HashMap<String, ActiveSearchInfo>> {
    SEARCH_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn register_search_cancel(session: u32, history: u32, query_str: &str) -> Arc<AtomicBool> {
    let key = run_key(session, history);
    let mut map = search_cancellations().lock().await;
    if let Some(existing) = map.get(&key) {
        if existing.query == query_str {
            // Same query signature: reuse existing flag so live updates/polls do not abort in-flight search
            return Arc::clone(&existing.flag);
        }
        // Different query: cancel the superseded search
        existing.flag.store(true, Ordering::Relaxed);
    }
    let new_flag = Arc::new(AtomicBool::new(false));
    map.insert(key, ActiveSearchInfo {
        query: query_str.to_string(),
        flag: Arc::clone(&new_flag),
    });
    new_flag
}

struct SearchCancelGuard {
    session: u32,
    history: u32,
    flag: Arc<AtomicBool>,
}

impl Drop for SearchCancelGuard {
    fn drop(&mut self) {
        let session = self.session;
        let history = self.history;
        let flag = Arc::clone(&self.flag);
        tokio::spawn(async move {
            let key = run_key(session, history);
            let mut map = search_cancellations().lock().await;
            if map.get(&key).map(|info| Arc::ptr_eq(&info.flag, &flag)).unwrap_or(false) {
                map.remove(&key);
            }
        });
    }
}

pub fn sort_fuzzer_rows_in_place<T: std::borrow::Borrow<FuzzerRequestRow>>(rows: &mut [T], sort_by: Option<&str>, is_desc: bool) {
    match sort_by {
        Some("statusCode") | Some("responseCode") => {
            rows.sort_by(|item_a, item_b| {
                let a = item_a.borrow();
                let b = item_b.borrow();
                let cmp = match (a.status_code, b.status_code) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a.id.cmp(&b.id),
                };
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("duration") => {
            rows.sort_by(|item_a, item_b| {
                let a = item_a.borrow();
                let b = item_b.borrow();
                let cmp = match (a.response_time_ms, b.response_time_ms) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a.id.cmp(&b.id),
                };
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("length") => {
            rows.sort_by(|item_a, item_b| {
                let a = item_a.borrow();
                let b = item_b.borrow();
                let cmp = match (a.response_length, b.response_length) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a.id.cmp(&b.id),
                };
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("status") => {
            rows.sort_by(|item_a, item_b| {
                let a = item_a.borrow();
                let b = item_b.borrow();
                let cmp = a.status.cmp(&b.status).then_with(|| a.id.cmp(&b.id));
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("payload") | Some("payloadPreview") => {
            rows.sort_by(|item_a, item_b| {
                let a = item_a.borrow();
                let b = item_b.borrow();
                let p_a = a.payload.as_deref().unwrap_or("");
                let p_b = b.payload.as_deref().unwrap_or("");
                let cmp = p_a.cmp(p_b).then_with(|| a.id.cmp(&b.id));
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("requestDate") => {
            rows.sort_by(|item_a, item_b| {
                let a = item_a.borrow();
                let b = item_b.borrow();
                let cmp = a.request_date.cmp(&b.request_date).then_with(|| a.id.cmp(&b.id));
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("id") => {
            rows.sort_by(|item_a, item_b| {
                let a = item_a.borrow();
                let b = item_b.borrow();
                let cmp = a.id.cmp(&b.id);
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        _ => {
            rows.sort_by_key(|r| r.borrow().id);
            if is_desc {
                rows.reverse();
            }
        }
    }
}

pub async fn init_fuzz_store(
    session: u32,
    history: u32,
    targets: &[FuzzTarget],
    config_snapshot: Option<crate::types::SessionPayload>,
) {
    let key = run_key(session, history);
    invalidate_fuzzer_search_cache(session, history).await;
    let mut id_map = HashMap::with_capacity(targets.len());
    let mut rows = Vec::with_capacity(targets.len());

    for (idx, target) in targets.iter().enumerate() {
        let sort_order = target.sort_order;
        id_map.insert(target.id.clone(), idx);
        rows.push(FuzzerRequestRow {
            id: sort_order,
            fuzz_request_id: target.id.clone(),
            raw_request: None,
            payload: target.payload.clone(),
            response: None,
            request_date: String::new(),
            status: "pending".to_string(),
            error_message: None,
            connection_dropped: false,
            worker_id: None,
            status_code: None,
            response_length: None,
            response_time_ms: None,
            chunk_id: None,
            chunk_index: None,
        });
    }

    fuzz_store().lock().await.insert(
        key,
        FuzzerRunData {
            rows,
            id_map,
            config_snapshot,
        },
    );
}

pub async fn update_store_completed(
    session: u32,
    history: u32,
    id: &str,
    request_date: i64,
    status_code: Option<u16>,
    response_length: Option<usize>,
    response_time_ms: Option<u128>,
    raw_response: Option<String>,
    worker_id: Option<u32>,
) {
    let key = run_key(session, history);
    let mut store = fuzz_store().lock().await;
    if let Some(run_data) = store.get_mut(&key) {
        if let Some(&idx) = run_data.id_map.get(id) {
            if let Some(row) = run_data.rows.get_mut(idx) {
                row.status = "completed".to_string();
                row.raw_request = None;
                row.error_message = None;
                row.connection_dropped = false;
                row.worker_id = worker_id;
                row.request_date = chrono::DateTime::from_timestamp_millis(request_date)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default();
                row.status_code = status_code;
                row.response_length = response_length;
                row.response_time_ms = response_time_ms;
                if let Some(resp) = raw_response {
                    row.response = Some(ReqRes {
                        request: String::new(),
                        response: resp,
                        response_time: response_time_ms.unwrap_or(0),
                    });
                }
            }
        }
    }
}

pub async fn update_store_error(
    session: u32,
    history: u32,
    id: &str,
    request_date: i64,
    message: String,
    connection_dropped: bool,
    worker_id: Option<u32>,
) {
    let key = run_key(session, history);
    let mut store = fuzz_store().lock().await;
    if let Some(run_data) = store.get_mut(&key) {
        if let Some(&idx) = run_data.id_map.get(id) {
            if let Some(row) = run_data.rows.get_mut(idx) {
                row.status = "error".to_string();
                row.error_message = Some(message);
                row.connection_dropped = connection_dropped;
                row.raw_request = None;
                row.worker_id = worker_id;
                row.request_date = chrono::DateTime::from_timestamp_millis(request_date)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default();
            }
        }
    }
}

pub async fn update_store_cancelled(session: u32, history: u32) {
    let key = run_key(session, history);
    let mut store = fuzz_store().lock().await;
    if let Some(run_data) = store.get_mut(&key) {
        for row in run_data.rows.iter_mut() {
            if row.status == "pending" {
                row.status = "cancelled".to_string();
            }
        }
    }
}

pub async fn update_store_pending(session: u32, history: u32, ids: &[String]) {
    let key = run_key(session, history);
    let mut store = fuzz_store().lock().await;
    if let Some(run_data) = store.get_mut(&key) {
        for id in ids {
            if let Some(&idx) = run_data.id_map.get(id) {
                if let Some(row) = run_data.rows.get_mut(idx) {
                    row.status = "pending".to_string();
                    row.error_message = None;
                    row.connection_dropped = false;
                }
            }
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerWindowResult {
    pub total: usize,
    pub items: Vec<FuzzerRequestRow>,
}

/// Convert a `FuzzerRequestDb` row into the serialisable `FuzzerRequestRow`
/// without loading the raw response body (that is handled by the viewer on demand).
fn db_row_to_request_row(r: &crate::ares_utils::database::fuzzer::FuzzerRequestDb) -> FuzzerRequestRow {
    let status = if r.error_message.is_some() || r.connection_dropped {
        "error".to_string()
    } else {
        "completed".to_string()
    };
    FuzzerRequestRow {
        id: r.sort_order as usize,
        fuzz_request_id: r.id.clone(),
        raw_request: None,
        payload: r.payload.clone(),
        response: None,
        request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default(),
        status,
        error_message: r.error_message.clone(),
        connection_dropped: r.connection_dropped,
        worker_id: r.worker_id.map(|w| w as u32),
        status_code: r.status_code.map(|c| c as u16),
        response_length: r.response_length.map(|l| l as usize),
        response_time_ms: r.response_time_ms.map(|t| t as u128),
        chunk_id: r.chunk_id,
        chunk_index: r.chunk_index,
    }
}

fn make_uncompleted_request_row(
    idx: usize,
    config_snapshot: Option<&crate::types::SessionPayload>,
    run_status: &str,
) -> FuzzerRequestRow {
    let (target_id, payload) = if let Some(cfg) = config_snapshot {
        crate::fuzzer::utils::generate_payload_for_sort_order(cfg, idx)
    } else {
        (format!("{idx}"), None)
    };
    let status = if run_status == "running" {
        "pending"
    } else {
        "cancelled"
    };
    FuzzerRequestRow {
        id: idx,
        fuzz_request_id: target_id,
        raw_request: None,
        payload,
        response: None,
        request_date: String::new(),
        status: status.to_string(),
        error_message: None,
        connection_dropped: false,
        worker_id: None,
        status_code: None,
        response_length: None,
        response_time_ms: None,
        chunk_id: None,
        chunk_index: None,
    }
}

#[tauri::command]
pub async fn get_fuzzer_history_window(
    app: tauri::AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    offset: usize,
    limit: usize,
    sort_by: Option<String>,
    sort_order: Option<String>,
    search_query: Option<String>,
    show_uncompleted: Option<bool>,
) -> Result<FuzzerWindowResult, String> {
    let t_window_start = std::time::Instant::now();
    let show_uncompleted_val = show_uncompleted.unwrap_or(false);
    let is_desc = sort_order
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("desc"))
        .unwrap_or(false);

    let has_query = search_query
        .as_deref()
        .map(|q| !q.trim().is_empty())
        .unwrap_or(false);

    eprintln!(
        "[FUZZER_SEARCH_BENCH] >>> get_fuzzer_history_window: session={}, history={}, offset={}, limit={}, query={:?}, show_uncompleted={}, sort_by={:?}, sort_order={:?}",
        selected_session, fuzz_history, offset, limit, search_query, show_uncompleted_val, sort_by, sort_order
    );

    let parsed_httpql = if has_query {
        let q_str = search_query.as_deref().unwrap().trim();

        // Load project presets if db available
        let preset_map: HashMap<String, String> = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
            if let Ok(pool) = db_state.pool().await {
                sqlx::query_as::<_, (String, String)>("SELECT alias, expression FROM preset_filters")
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .collect()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        match crate::ares_utils::httpql::parse_httpql_with_presets(q_str, &preset_map) {
            Ok(Some(expr)) => Some(expr),
            Ok(None) => None,
            Err(_) => {
                // If there is a syntax error, fall back to unfiltered (display all)
                None
            }
        }
    } else {
        None
    };

    let key = run_key(selected_session, fuzz_history);
    let t_store_lock = std::time::Instant::now();
    let store = fuzz_store().lock().await;
    let store_lock_time = t_store_lock.elapsed();

    // ─── 1. In-Memory Store for Live / Active Runs ─────────────────────────
    if store.contains_key(&key) {
        eprintln!(
            "[FUZZER_SEARCH_BENCH] PATH: IN-MEMORY FUZZ_STORE (lock wait: {:?})",
            store_lock_time
        );
        let run_data = store.get(&key).unwrap();
        eprintln!(
            "[FUZZER_SEARCH_BENCH]   fuzz_store has {} rows in memory",
            run_data.rows.len()
        );
        let target_rows: Vec<&FuzzerRequestRow> = if show_uncompleted_val {
            run_data.rows.iter().collect()
        } else {
            run_data.rows.iter().filter(|r| r.status == "completed" || r.status == "error").collect()
        };

        let mut filtered_refs: Vec<&FuzzerRequestRow> = if let Some(ref expr) = parsed_httpql {
            let (tmpl_method, tmpl_path) = run_data.config_snapshot
                .as_ref()
                .map(|cfg| {
                    let meta = crate::ares_utils::parse::parse_request_line(cfg.raw_request.as_bytes());
                    (meta.method, meta.path)
                })
                .unwrap_or((String::new(), String::new()));

            let tmpl_host = run_data.config_snapshot
                .as_ref()
                .and_then(|cfg| url::Url::parse(&cfg.metadata.target_url).ok())
                .and_then(|url| url.host_str().map(String::from))
                .unwrap_or_default();

            let is_https = run_data.config_snapshot
                .as_ref()
                .map_or(false, |cfg| cfg.metadata.target_url.starts_with("https://"));

            let t_mem_filter = std::time::Instant::now();
            let res: Vec<&FuzzerRequestRow> = target_rows.into_iter().filter(|r| {
                let raw_resp_str = r.response.as_ref().map(|resp| resp.response.as_str());
                let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                    r.id as u32,
                    r.status_code.map(|c| c as i64).unwrap_or(0),
                    r.response_length.map(|l| l as i64).unwrap_or(0),
                    r.response_time_ms.map(|t| t as i64).unwrap_or(0),
                    chrono::DateTime::parse_from_rfc3339(&r.request_date)
                        .map(|dt| dt.timestamp_millis())
                        .unwrap_or(0),
                    &r.status,
                    raw_resp_str,
                    r.payload.as_deref(),
                    &r.fuzz_request_id,
                    run_data.config_snapshot.as_ref(),
                    &tmpl_method,
                    &tmpl_host,
                    &tmpl_path,
                    is_https,
                );
                expr.evaluate(&item)
            }).collect();
            eprintln!(
                "[FUZZER_SEARCH_BENCH]   In-memory HTTPQL filter finished in {:?}, matched {} of rows",
                t_mem_filter.elapsed(),
                res.len()
            );
            res
        } else {
            target_rows
        };

        let total = filtered_refs.len();
        let t_mem_sort = std::time::Instant::now();
        sort_fuzzer_rows_in_place(&mut filtered_refs, sort_by.as_deref(), is_desc);
        let start = offset.min(total);
        let end = (offset + limit).min(total);
        let items: Vec<FuzzerRequestRow> = filtered_refs[start..end].iter().map(|&r| {
            let mut row = r.clone();
            row.response = None;
            row.raw_request = None;
            row
        }).collect();
        eprintln!(
            "[FUZZER_SEARCH_BENCH]   In-memory sort & window slice in {:?}",
            t_mem_sort.elapsed()
        );
        eprintln!(
            "[FUZZER_SEARCH_BENCH] <<< get_fuzzer_history_window (IN-MEMORY) completed in {:?}",
            t_window_start.elapsed()
        );

        return Ok(FuzzerWindowResult { total, items });
    }

    drop(store);
    eprintln!(
        "[FUZZER_SEARCH_BENCH] PATH: SQLITE (not in active fuzz_store, elapsed so far: {:?})",
        t_window_start.elapsed()
    );

    // ─── 2. SQLite Fallback for Persisted History Runs ─────────────────────
    if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        if let Ok(pool) = db_state.pool().await {
            let t_resolve = std::time::Instant::now();
            let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(
                &pool,
                selected_session as usize,
                fuzz_history as usize,
            )
            .await;
            eprintln!(
                "[FUZZER_SEARCH_BENCH]   Resolved run_id={} in {:?}",
                run_id,
                t_resolve.elapsed()
            );

            let t_run_info = std::time::Instant::now();
            let run_info: Option<(i64, String, Option<String>)> = sqlx::query_as(
                "SELECT total, status, config_snapshot FROM fuzzer_runs WHERE id = ?"
            )
            .bind(&run_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);
            eprintln!(
                "[FUZZER_SEARCH_BENCH]   Fetched run_info in {:?}",
                t_run_info.elapsed()
            );

            if let Some((total_i64, run_status, config_snapshot_str)) = run_info {
                let total = total_i64 as usize;
                let config_snapshot: Option<crate::types::SessionPayload> = config_snapshot_str
                    .and_then(|s| serde_json::from_str(&s).ok());

                let is_default_sort = (sort_by.is_none() || sort_by.as_deref() == Some("id") || sort_by.as_deref() == Some("sortOrder")) && parsed_httpql.is_none();

                if show_uncompleted_val {
                    if is_default_sort {
                        let start = offset.min(total);
                        let end = (offset + limit).min(total);

                        let (min_sort, max_sort) = if !is_desc {
                            (start as i64, end as i64)
                        } else {
                            (
                                total.saturating_sub(end) as i64,
                                total.saturating_sub(start) as i64,
                            )
                        };

                        let existing_rows = crate::ares_utils::database::fuzzer::fetch_fuzzer_requests_in_range(
                            &pool,
                            &run_id,
                            min_sort,
                            max_sort,
                        )
                        .await
                        .unwrap_or_default();

                        let mut existing_map = HashMap::with_capacity(existing_rows.len());
                        for r in existing_rows {
                            existing_map.insert(r.sort_order as usize, r);
                        }

                        let mut items = Vec::with_capacity(end - start);
                        for i in start..end {
                            let idx = if !is_desc { i } else { total - 1 - i };
                            if let Some(r) = existing_map.remove(&idx) {
                                items.push(db_row_to_request_row(&r));
                            } else {
                                items.push(make_uncompleted_request_row(
                                    idx,
                                    config_snapshot.as_ref(),
                                    &run_status,
                                ));
                            }
                        }

                        return Ok(FuzzerWindowResult { total, items });
                    } else {
                        // Non-default sort or HTTPQL query with show_uncompleted:
                        eprintln!("[FUZZER_SEARCH_BENCH] SQLite Path (show_uncompleted=true, custom sort/HTTPQL)");
                        let t_fetch_db = std::time::Instant::now();
                        let db_rows: Vec<crate::ares_utils::database::fuzzer::FuzzerRequestDb> = sqlx::query_as(
                            "SELECT * FROM fuzzer_requests WHERE run_id = ? ORDER BY sort_order ASC"
                        )
                        .bind(&run_id)
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default();
                        eprintln!(
                            "[FUZZER_SEARCH_BENCH]   Fetched {} rows from SQLite in {:?}",
                            db_rows.len(),
                            t_fetch_db.elapsed()
                        );

                        let needs_resp = parsed_httpql.as_ref().map_or(false, crate::ares_utils::httpql::has_response_content_checks);

                        let (tmpl_method, tmpl_path) = config_snapshot
                            .as_ref()
                            .map(|cfg| {
                                let meta = crate::ares_utils::parse::parse_request_line(cfg.raw_request.as_bytes());
                                (meta.method, meta.path)
                            })
                            .unwrap_or((String::new(), String::new()));

                        let tmpl_host = config_snapshot
                            .as_ref()
                            .and_then(|cfg| url::Url::parse(&cfg.metadata.target_url).ok())
                            .and_then(|url| url.host_str().map(String::from))
                            .unwrap_or_default();

                        let is_https = config_snapshot
                            .as_ref()
                            .map_or(false, |cfg| cfg.metadata.target_url.starts_with("https://"));

                        let mut filtered_rows = Vec::with_capacity(total);

                        if needs_resp {
                            let mut chunk_groups: std::collections::BTreeMap<i64, Vec<crate::ares_utils::database::fuzzer::FuzzerRequestDb>> = std::collections::BTreeMap::new();
                            let mut other_completed_rows = Vec::new();
                            let mut completed_indices = std::collections::HashSet::with_capacity(db_rows.len());

                            for r in db_rows {
                                completed_indices.insert(r.sort_order as usize);
                                match r.chunk_id {
                                    Some(cid) => chunk_groups.entry(cid).or_default().push(r),
                                    None => other_completed_rows.push(r),
                                }
                            }

                            if !chunk_groups.is_empty() {
                                let total_cand: usize = chunk_groups.values().map(|v| v.len()).sum();
                                eprintln!(
                                    "[FUZZER_SEARCH_BENCH]   show_uncompleted: Processing {} chunks ({} candidates)",
                                    chunk_groups.len(),
                                    total_cand
                                );
                                let chunk_ids: Vec<i64> = chunk_groups.keys().copied().collect();
                                let t_blobs = std::time::Instant::now();
                                let mut blobs_map = crate::ares_utils::database::fuzzer::fetch_fuzzer_chunk_blobs_batch(&pool, &chunk_ids, None).await.unwrap_or_default();
                                eprintln!(
                                    "[FUZZER_SEARCH_BENCH]   show_uncompleted: Batch fetched {} blobs in {:?}",
                                    blobs_map.len(),
                                    t_blobs.elapsed()
                                );

                                let mut chunk_tasks: Vec<(i64, Vec<crate::ares_utils::database::fuzzer::FuzzerRequestDb>, Option<Vec<u8>>)> =
                                    Vec::with_capacity(chunk_groups.len());
                                for (cid, rows) in chunk_groups {
                                    let blob = blobs_map.remove(&cid);
                                    chunk_tasks.push((cid, rows, blob));
                                }

                                let parsed_httpql_clone = parsed_httpql.clone();
                                let config_snapshot_clone = config_snapshot.clone();
                                let tmpl_method_clone = tmpl_method.clone();
                                let tmpl_host_clone = tmpl_host.clone();
                                let tmpl_path_clone = tmpl_path.clone();

                                let t_rayon = std::time::Instant::now();
                                let matched_rows: Vec<FuzzerRequestRow> = tokio::task::spawn_blocking(move || {
                                    use rayon::prelude::*;
                                    chunk_tasks
                                        .into_par_iter()
                                        .flat_map(|(_cid, rows, blob)| {
                                            let Some(blob) = blob else { return Vec::new(); };
                                            let Ok(resps) = crate::fuzzer::chunk_manager::decompress_chunk(&blob) else { return Vec::new(); };

                                            let mut matched = Vec::new();
                                            for r in rows {
                                                if let Some(cidx) = r.chunk_index {
                                                    if cidx >= 0 && (cidx as usize) < resps.len() {
                                                        let raw_resp = &resps[cidx as usize];
                                                        let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                                                            r.sort_order as u32,
                                                            r.status_code.unwrap_or(0),
                                                            r.response_length.unwrap_or(0),
                                                            r.response_time_ms.unwrap_or(0),
                                                            r.request_date,
                                                            if r.error_message.is_some() || r.connection_dropped { "error" } else { "completed" },
                                                            Some(raw_resp.as_str()),
                                                            r.payload.as_deref(),
                                                            &r.id,
                                                            config_snapshot_clone.as_ref(),
                                                            &tmpl_method_clone,
                                                            &tmpl_host_clone,
                                                            &tmpl_path_clone,
                                                            is_https,
                                                        );
                                                        if let Some(ref expr) = parsed_httpql_clone {
                                                            if expr.evaluate(&item) {
                                                                matched.push(db_row_to_request_row(&r));
                                                            }
                                                        } else {
                                                            matched.push(db_row_to_request_row(&r));
                                                        }
                                                    }
                                                }
                                            }
                                            matched
                                        })
                                        .collect()
                                })
                                .await
                                .unwrap_or_default();

                                eprintln!(
                                    "[FUZZER_SEARCH_BENCH]   show_uncompleted: Rayon parallel decompress + regex matched {} in {:?}",
                                    matched_rows.len(),
                                    t_rayon.elapsed()
                                );

                                filtered_rows.extend(matched_rows);
                            }

                            for r in other_completed_rows {
                                if let Some(ref expr) = parsed_httpql {
                                    let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                                        r.sort_order as u32,
                                        r.status_code.unwrap_or(0),
                                        r.response_length.unwrap_or(0),
                                        r.response_time_ms.unwrap_or(0),
                                        r.request_date,
                                        if r.error_message.is_some() || r.connection_dropped { "error" } else { "completed" },
                                        None,
                                        r.payload.as_deref(),
                                        &r.id,
                                        config_snapshot.as_ref(),
                                        &tmpl_method,
                                        &tmpl_host,
                                        &tmpl_path,
                                        is_https,
                                    );
                                    if expr.evaluate(&item) {
                                        filtered_rows.push(db_row_to_request_row(&r));
                                    }
                                } else {
                                    filtered_rows.push(db_row_to_request_row(&r));
                                }
                            }

                            for idx in 0..total {
                                if !completed_indices.contains(&idx) {
                                    let uncompleted = make_uncompleted_request_row(
                                        idx,
                                        config_snapshot.as_ref(),
                                        &run_status,
                                    );
                                    if let Some(ref expr) = parsed_httpql {
                                        let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                                            uncompleted.id as u32,
                                            uncompleted.status_code.map(|c| c as i64).unwrap_or(0),
                                            uncompleted.response_length.map(|l| l as i64).unwrap_or(0),
                                            uncompleted.response_time_ms.map(|t| t as i64).unwrap_or(0),
                                            0,
                                            &uncompleted.status,
                                            None,
                                            uncompleted.payload.as_deref(),
                                            &uncompleted.fuzz_request_id,
                                            config_snapshot.as_ref(),
                                            &tmpl_method,
                                            &tmpl_host,
                                            &tmpl_path,
                                            is_https,
                                        );
                                        if expr.evaluate(&item) {
                                            filtered_rows.push(uncompleted);
                                        }
                                    } else {
                                        filtered_rows.push(uncompleted);
                                    }
                                }
                            }
                        } else {
                            let mut existing_map = HashMap::with_capacity(db_rows.len());
                            for r in db_rows {
                                existing_map.insert(r.sort_order as usize, r);
                            }

                            for idx in 0..total {
                                if let Some(r) = existing_map.remove(&idx) {
                                    if let Some(ref expr) = parsed_httpql {
                                        let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                                            r.sort_order as u32,
                                            r.status_code.unwrap_or(0),
                                            r.response_length.unwrap_or(0),
                                            r.response_time_ms.unwrap_or(0),
                                            r.request_date,
                                            if r.error_message.is_some() || r.connection_dropped { "error" } else { "completed" },
                                            None,
                                            r.payload.as_deref(),
                                            &r.id,
                                            config_snapshot.as_ref(),
                                            &tmpl_method,
                                            &tmpl_host,
                                            &tmpl_path,
                                            is_https,
                                        );
                                        if expr.evaluate(&item) {
                                            filtered_rows.push(db_row_to_request_row(&r));
                                        }
                                    } else {
                                        filtered_rows.push(db_row_to_request_row(&r));
                                    }
                                } else {
                                    let uncompleted = make_uncompleted_request_row(
                                        idx,
                                        config_snapshot.as_ref(),
                                        &run_status,
                                    );
                                    if let Some(ref expr) = parsed_httpql {
                                        let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                                            uncompleted.id as u32,
                                            uncompleted.status_code.map(|c| c as i64).unwrap_or(0),
                                            uncompleted.response_length.map(|l| l as i64).unwrap_or(0),
                                            uncompleted.response_time_ms.map(|t| t as i64).unwrap_or(0),
                                            0,
                                            &uncompleted.status,
                                            None,
                                            uncompleted.payload.as_deref(),
                                            &uncompleted.fuzz_request_id,
                                            config_snapshot.as_ref(),
                                            &tmpl_method,
                                            &tmpl_host,
                                            &tmpl_path,
                                            is_https,
                                        );
                                        if expr.evaluate(&item) {
                                            filtered_rows.push(uncompleted);
                                        }
                                    } else {
                                        filtered_rows.push(uncompleted);
                                    }
                                }
                            }
                        }

                        let total = filtered_rows.len();
                        sort_fuzzer_rows_in_place(&mut filtered_rows, sort_by.as_deref(), is_desc);
                        let start = offset.min(total);
                        let end = (offset + limit).min(total);
                        let items = filtered_rows[start..end].to_vec();
                        return Ok(FuzzerWindowResult { total, items });
                    }
                } else {
                    let (raw_template_req, target_url) = config_snapshot
                        .as_ref()
                        .map(|cfg| (
                            Some(cfg.raw_request.as_str()),
                            Some(cfg.metadata.target_url.as_str()),
                        ))
                        .unwrap_or((None, None));

                    let needs_memory_filter = parsed_httpql
                        .as_ref()
                        .map_or(false, |expr| crate::ares_utils::httpql::has_in_memory_checks(expr, raw_template_req, target_url));

                    if needs_memory_filter {
                        // ─── Path B: Content-heavy search using FuzzerSearchCache ────
                        eprintln!("[FUZZER_SEARCH_BENCH] SQLite Path (show_uncompleted=false, needs_memory_filter=true)");
                        let query_str = search_query.as_deref().unwrap_or("").trim();
                        let cache_key = format!("{}:{}:{}", selected_session, fuzz_history, query_str);
                        let is_active = is_run_active(selected_session, fuzz_history).await || run_status == "running";

                        let cancel_flag = register_search_cancel(selected_session, fuzz_history, query_str).await;
                        let _cancel_guard = SearchCancelGuard {
                            session: selected_session,
                            history: fuzz_history,
                            flag: Arc::clone(&cancel_flag),
                        };

                        let t_lock_cache = std::time::Instant::now();
                        let mut cache = search_cache().lock().await;
                        let existing_pos = cache.iter().position(|c| c.key == cache_key);
                        eprintln!(
                            "[FUZZER_SEARCH_BENCH]   search_cache locked in {:?}, hit={}",
                            t_lock_cache.elapsed(),
                            existing_pos.is_some()
                        );

                        let mut all_rows = match existing_pos {
                            Some(pos) => {
                                eprintln!("[FUZZER_SEARCH_BENCH]   Search cache HIT for key={}", cache_key);
                                let mut cached_item = cache.remove(pos).unwrap();
                                cached_item.last_accessed = std::time::Instant::now();
                                // Drop the cache lock immediately so concurrent window/search requests aren't stalled
                                drop(cache);

                                if is_active {
                                    // Incremental scan: inspect requests completed since last scan
                                    let since_date = cached_item.last_scanned_date.saturating_sub(2000);
                                    let t_inc = std::time::Instant::now();
                                    let inc_res = crate::ares_utils::database::fuzzer::query_fuzzer_requests_matching_since(
                                        &pool,
                                        &run_id,
                                        since_date,
                                        parsed_httpql.as_ref(),
                                        raw_template_req,
                                        target_url,
                                        config_snapshot.clone(),
                                        Some(Arc::clone(&cancel_flag)),
                                    ).await;

                                    match inc_res {
                                        Ok((new_db_rows, new_max_date)) => {
                                            eprintln!(
                                                "[FUZZER_SEARCH_BENCH]   Incremental scan found {} new rows in {:?}",
                                                new_db_rows.len(),
                                                t_inc.elapsed()
                                            );
                                            for r in new_db_rows {
                                                if cached_item.seen_ids.insert(r.id.clone()) {
                                                    let status = if r.error_message.is_some() || r.connection_dropped {
                                                        "error".to_string()
                                                    } else {
                                                        "completed".to_string()
                                                    };
                                                    cached_item.rows.push(FuzzerRequestRow {
                                                        id: r.sort_order as usize,
                                                        fuzz_request_id: r.id,
                                                        raw_request: None,
                                                        payload: r.payload,
                                                        response: None,
                                                        request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
                                                            .map(|dt| dt.to_rfc3339())
                                                            .unwrap_or_default(),
                                                        status,
                                                        error_message: r.error_message,
                                                        connection_dropped: r.connection_dropped,
                                                        worker_id: r.worker_id.map(|w| w as u32),
                                                        status_code: r.status_code.map(|c| c as u16),
                                                        response_length: r.response_length.map(|l| l as usize),
                                                        response_time_ms: r.response_time_ms.map(|t| t as u128),
                                                        chunk_id: r.chunk_id,
                                                        chunk_index: r.chunk_index,
                                                    });
                                                }
                                            }
                                            cached_item.last_scanned_date = cached_item.last_scanned_date.max(new_max_date);
                                        }
                                        Err(e) if e == "Search cancelled" => {
                                            eprintln!("[FUZZER_SEARCH_BENCH]   Incremental search was cancelled; returning empty window");
                                            return Ok(FuzzerWindowResult { total: 0, items: Vec::new() });
                                        }
                                        Err(e) => {
                                            eprintln!("[FUZZER_SEARCH_BENCH]   Incremental search failed: {}", e);
                                        }
                                    }
                                } else {
                                    eprintln!(
                                        "[FUZZER_SEARCH_BENCH]   Run is completed/inactive; returning cached {} rows instantly",
                                        cached_item.rows.len()
                                    );
                                }

                                let rows = cached_item.rows.clone();
                                let mut cache = search_cache().lock().await;
                                cache.push_back(cached_item);
                                drop(cache);
                                rows
                            }
                            None => {
                                drop(cache);
                                eprintln!("[FUZZER_SEARCH_BENCH]   Search cache MISS for key={}", cache_key);
                                let t_miss = std::time::Instant::now();
                                let scan_res = crate::ares_utils::database::fuzzer::query_fuzzer_requests_matching_since(
                                    &pool,
                                    &run_id,
                                    0,
                                    parsed_httpql.as_ref(),
                                    raw_template_req,
                                    target_url,
                                    config_snapshot.clone(),
                                    Some(Arc::clone(&cancel_flag)),
                                ).await;

                                let (db_rows, max_date) = match scan_res {
                                    Ok(res) => res,
                                    Err(e) if e == "Search cancelled" => {
                                        eprintln!("[FUZZER_SEARCH_BENCH]   Search was cancelled; aborting window response");
                                        return Ok(FuzzerWindowResult { total: 0, items: Vec::new() });
                                    }
                                    Err(e) => {
                                        eprintln!("[FUZZER_SEARCH_BENCH]   Search failed: {}", e);
                                        (Vec::new(), 0)
                                    }
                                };
                                eprintln!(
                                    "[FUZZER_SEARCH_BENCH]   Full scan via query_fuzzer_requests_matching_since completed in {:?} ({} rows)",
                                    t_miss.elapsed(),
                                    db_rows.len()
                                );

                                let mut seen_ids = std::collections::HashSet::with_capacity(db_rows.len());
                                let converted: Vec<FuzzerRequestRow> = db_rows.into_iter().map(|r| {
                                    seen_ids.insert(r.id.clone());
                                    let status = if r.error_message.is_some() || r.connection_dropped {
                                        "error".to_string()
                                    } else {
                                        "completed".to_string()
                                    };
                                    FuzzerRequestRow {
                                        id: r.sort_order as usize,
                                        fuzz_request_id: r.id,
                                        raw_request: None,
                                        payload: r.payload,
                                        response: None,
                                        request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
                                            .map(|dt| dt.to_rfc3339())
                                            .unwrap_or_default(),
                                        status,
                                        error_message: r.error_message,
                                        connection_dropped: r.connection_dropped,
                                        worker_id: r.worker_id.map(|w| w as u32),
                                        status_code: r.status_code.map(|c| c as u16),
                                        response_length: r.response_length.map(|l| l as usize),
                                        response_time_ms: r.response_time_ms.map(|t| t as u128),
                                        chunk_id: r.chunk_id,
                                        chunk_index: r.chunk_index,
                                    }
                                }).collect();

                                let mut cache = search_cache().lock().await;
                                if let Some(pos) = cache.iter().position(|c| c.key == cache_key) {
                                    cache.remove(pos);
                                }
                                if cache.len() >= 10 {
                                    cache.pop_front();
                                }
                                cache.push_back(CachedSearch {
                                    key: cache_key,
                                    rows: converted.clone(),
                                    seen_ids,
                                    last_scanned_date: max_date,
                                    last_accessed: std::time::Instant::now(),
                                });
                                drop(cache);
                                converted
                            }
                        };

                        let total = all_rows.len();
                        let t_sort_b = std::time::Instant::now();
                        sort_fuzzer_rows_in_place(&mut all_rows, sort_by.as_deref(), is_desc);
                        let start = offset.min(total);
                        let end = (offset + limit).min(total);
                        let items = all_rows[start..end].to_vec();
                        eprintln!(
                            "[FUZZER_SEARCH_BENCH]   Path B sort & slice in {:?}",
                            t_sort_b.elapsed()
                        );
                        eprintln!(
                            "[FUZZER_SEARCH_BENCH] <<< get_fuzzer_history_window (Path B) completed in {:?} (total_matches={})",
                            t_window_start.elapsed(),
                            total
                        );
                        return Ok(FuzzerWindowResult { total, items });
                    } else {
                        // ─── Path A: Pure SQL fast path for metadata queries & sorting ───
                        if let Ok((total, db_rows)) = crate::ares_utils::database::fuzzer::query_fuzzer_requests_window(
                            &pool,
                            &run_id,
                            offset,
                            limit,
                            sort_by.as_deref(),
                            sort_order.as_deref(),
                            parsed_httpql.as_ref(),
                            raw_template_req,
                            target_url,
                        ).await {
                            let items: Vec<FuzzerRequestRow> = db_rows.into_iter().map(|r| {
                                let status = if r.error_message.is_some() || r.connection_dropped {
                                    "error".to_string()
                                } else {
                                    "completed".to_string()
                                };
                                FuzzerRequestRow {
                                    id: r.sort_order as usize,
                                    fuzz_request_id: r.id,
                                    raw_request: None,
                                    payload: r.payload,
                                    response: None,
                                    request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
                                        .map(|dt| dt.to_rfc3339())
                                        .unwrap_or_default(),
                                    status,
                                    error_message: r.error_message,
                                    connection_dropped: r.connection_dropped,
                                    worker_id: r.worker_id.map(|w| w as u32),
                                    status_code: r.status_code.map(|c| c as u16),
                                    response_length: r.response_length.map(|l| l as usize),
                                    response_time_ms: r.response_time_ms.map(|t| t as u128),
                                    chunk_id: r.chunk_id,
                                    chunk_index: r.chunk_index,
                                }
                            }).collect();
                            return Ok(FuzzerWindowResult { total, items });
                        }
                    }
                }
            }
        }
    }
    Ok(FuzzerWindowResult { total: 0, items: vec![] })
}

// ---------------------------------------------------------------------------
// Streaming HTTPQL search (Path B: regex / body / header / bare-text queries)
// ---------------------------------------------------------------------------

/// Events emitted per-chunk via a Tauri v2 Channel during a streaming search.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FuzzerSearchEvent {
    /// Batch of matching rows produced from one decompressed chunk.
    Items {
        items: Vec<FuzzerRequestRow>,
        #[serde(rename = "totalSoFar")]
        total_so_far: usize,
    },
    /// All chunks have been processed — carries the definitive total.
    Done { total: usize },
}

/// Stream HTTPQL search results chunk-by-chunk.
///
/// When the HTTPQL expression requires in-memory body/header/regex evaluation
/// (Path B), this command decompresses one chunk at a time, evaluates each
/// response against the expression, and immediately emits matching rows via
/// the Tauri `Channel` — so the frontend can render results progressively
/// without waiting for the full scan to complete.
///
/// If the fuzzer is actively running, this function first scans historical
/// requests up to the current watermark, then subscribes to live worker
/// events, micro-batching and streaming new matching requests in real-time.
#[tauri::command]
pub async fn stream_fuzzer_search(
    app: tauri::AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    search_query: String,
    on_event: tauri::ipc::Channel<FuzzerSearchEvent>,
) -> Result<(), String> {
    // Parse the HTTPQL query. An empty / invalid expression streams nothing.
    let expr = match crate::ares_utils::httpql::parse_httpql(search_query.trim())
        .ok()
        .flatten()
    {
        Some(e) => e,
        None => {
            let _ = on_event.send(FuzzerSearchEvent::Done { total: 0 });
            return Ok(());
        }
    };

    let db_state = match app.try_state::<crate::ares_utils::database::DbState>() {
        Some(s) => s,
        None => {
            let _ = on_event.send(FuzzerSearchEvent::Done { total: 0 });
            return Ok(());
        }
    };
    let pool = match db_state.pool().await {
        Ok(p) => p,
        Err(_) => {
            let _ = on_event.send(FuzzerSearchEvent::Done { total: 0 });
            return Ok(());
        }
    };

    let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(
        &pool,
        selected_session as usize,
        fuzz_history as usize,
    )
    .await;

    // Retrieve config snapshot so we can provide req fields (method, path, host).
    let config_snapshot_str: Option<String> =
        sqlx::query_scalar("SELECT config_snapshot FROM fuzzer_runs WHERE id = ?")
            .bind(&run_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);

    let config_snapshot: Option<std::sync::Arc<crate::types::SessionPayload>> =
        config_snapshot_str
            .and_then(|s| serde_json::from_str(&s).ok())
            .map(std::sync::Arc::new);

    let raw_template_req_owned: Option<String> =
        config_snapshot.as_ref().map(|cfg| cfg.raw_request.clone());
    let target_url_owned: Option<String> = config_snapshot
        .as_ref()
        .map(|cfg| cfg.metadata.target_url.clone());

    let raw_template_req = raw_template_req_owned.as_deref();
    let target_url = target_url_owned.as_deref();

    // Optimize query evaluation order
    let mut expr = expr;
    expr.optimize_evaluation_order();
    let expr = std::sync::Arc::new(expr);

    // Determine whether we need in-memory chunk evaluation.
    let needs_memory_filter =
        crate::ares_utils::httpql::has_response_content_checks(&expr);

    let mut total_so_far: usize = 0;

    if !needs_memory_filter {
        // Path A: SQL filter with batching in chunks of 50
        let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT * FROM fuzzer_requests WHERE run_id = ",
        );
        builder.push_bind(&run_id);
        builder.push(" AND ");
        crate::ares_utils::httpql::compile_fuzzer_httpql_to_sql(
            &mut builder,
            &expr,
            raw_template_req,
            target_url,
        );
        builder.push(" ORDER BY sort_order ASC");

        let db_rows = builder
            .build_query_as::<crate::ares_utils::database::fuzzer::FuzzerRequestDb>()
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

        for chunk in db_rows.chunks(50) {
            total_so_far += chunk.len();
            let items: Vec<FuzzerRequestRow> = chunk.iter().map(db_row_to_request_row).collect();
            if on_event
                .send(FuzzerSearchEvent::Items {
                    total_so_far,
                    items,
                })
                .is_err()
            {
                return Ok(());
            }
        }
    } else {
        // Path B: parallel chunk-by-chunk streaming evaluation up to watermark
        let concurrency = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .max(1);

        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));

        let (tmpl_method, tmpl_path) = raw_template_req
            .map(|r| {
                let meta = crate::ares_utils::parse::parse_request_line(r.as_bytes());
                (meta.method, meta.path)
            })
            .unwrap_or((String::new(), String::new()));

        let tmpl_host = target_url
            .and_then(|u| url::Url::parse(u).ok())
            .and_then(|url| url.host_str().map(String::from))
            .unwrap_or_default();

        let is_https = target_url.map_or(false, |u| u.starts_with("https://"));

        let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT * FROM fuzzer_requests WHERE run_id = ",
        );
        builder.push_bind(&run_id);
        builder.push(" AND ");
        crate::ares_utils::httpql::compile_fuzzer_httpql_to_sql(
            &mut builder,
            &expr,
            raw_template_req,
            target_url,
        );
        builder.push(" ORDER BY sort_order ASC");

        let candidates = match builder
            .build_query_as::<crate::ares_utils::database::fuzzer::FuzzerRequestDb>()
            .fetch_all(&pool)
            .await
        {
            Ok(rows) => rows,
            Err(_) => {
                let _ = on_event.send(FuzzerSearchEvent::Done { total: 0 });
                return Ok(());
            }
        };

        let mut chunk_groups: std::collections::BTreeMap<
            i64,
            Vec<crate::ares_utils::database::fuzzer::FuzzerRequestDb>,
        > = std::collections::BTreeMap::new();
        let mut no_chunk_rows: Vec<crate::ares_utils::database::fuzzer::FuzzerRequestDb> =
            Vec::new();

        for row in candidates {
            match row.chunk_id {
                Some(cid) => chunk_groups.entry(cid).or_default().push(row),
                None => no_chunk_rows.push(row),
            }
        }

        if !no_chunk_rows.is_empty() {
            let expr_nc = expr.clone();
            let tmpl_method_nc = tmpl_method.clone();
            let tmpl_host_nc = tmpl_host.clone();
            let tmpl_path_nc = tmpl_path.clone();
            let config_snapshot_nc = config_snapshot.clone();

            let no_chunk_matches = tokio::task::spawn_blocking(move || {
                let cfg_ref = config_snapshot_nc.as_deref();
                use rayon::prelude::*;
                no_chunk_rows
                    .par_iter()
                    .filter_map(|row| {
                        let state = if row.error_message.is_some() || row.connection_dropped {
                            "error"
                        } else {
                            "pending"
                        };
                        let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                            row.sort_order as u32,
                            row.status_code.unwrap_or(0),
                            row.response_length.unwrap_or(0),
                            row.response_time_ms.unwrap_or(0),
                            row.request_date,
                            state,
                            None,
                            row.payload.as_deref(),
                            &row.id,
                            cfg_ref,
                            &tmpl_method_nc,
                            &tmpl_host_nc,
                            &tmpl_path_nc,
                            is_https,
                        );
                        if expr_nc.evaluate(&item) {
                            Some(db_row_to_request_row(row))
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .await
            .unwrap_or_default();

            if !no_chunk_matches.is_empty() {
                total_so_far += no_chunk_matches.len();
                if on_event
                    .send(FuzzerSearchEvent::Items {
                        items: no_chunk_matches,
                        total_so_far,
                    })
                    .is_err()
                {
                    return Ok(());
                }
            }
        }

        let mut join_set =
            tokio::task::JoinSet::<Result<Vec<FuzzerRequestRow>, String>>::new();

        let chunk_ids: Vec<i64> = chunk_groups.keys().copied().collect();
        let mut blobs_map = crate::ares_utils::database::fuzzer::fetch_fuzzer_chunk_blobs_batch(
            &pool,
            &chunk_ids,
            None,
        )
        .await
        .unwrap_or_default();

        for (chunk_id, rows) in chunk_groups {
            let sem = semaphore.clone();
            let expr = expr.clone();
            let tmpl_method = tmpl_method.clone();
            let tmpl_host = tmpl_host.clone();
            let tmpl_path = tmpl_path.clone();
            let config_snapshot_cg = config_snapshot.clone();
            let blob = blobs_map.remove(&chunk_id);

            join_set.spawn(async move {
                let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
                let Some(blob) = blob else {
                    return Ok(Vec::new());
                };

                let matches = tokio::task::spawn_blocking(move || {
                    let Ok(resps) = crate::fuzzer::chunk_manager::decompress_chunk(&blob) else {
                        return Vec::new();
                    };
                    let cfg_ref = config_snapshot_cg.as_deref();
                    use rayon::prelude::*;
                    rows.par_iter()
                        .filter_map(|row| {
                            let cidx = row.chunk_index? as usize;
                            let raw_resp = resps.get(cidx)?;
                            let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                                row.sort_order as u32,
                                row.status_code.unwrap_or(0),
                                row.response_length.unwrap_or(0),
                                row.response_time_ms.unwrap_or(0),
                                row.request_date,
                                "completed",
                                Some(raw_resp.as_str()),
                                row.payload.as_deref(),
                                &row.id,
                                cfg_ref,
                                &tmpl_method,
                                &tmpl_host,
                                &tmpl_path,
                                is_https,
                            );
                            if expr.evaluate(&item) {
                                Some(db_row_to_request_row(row))
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                })
                .await
                .map_err(|e| e.to_string())?;

                Ok(matches)
            });
        }

        const BATCH_SIZE: usize = 50;
        let mut batch: Vec<FuzzerRequestRow> = Vec::with_capacity(BATCH_SIZE);

        while let Some(result) = join_set.join_next().await {
            if let Ok(Ok(matches)) = result {
                batch.extend(matches);
                if batch.len() >= BATCH_SIZE {
                    total_so_far += batch.len();
                    let to_send = std::mem::take(&mut batch);
                    if on_event
                        .send(FuzzerSearchEvent::Items {
                            items: to_send,
                            total_so_far,
                        })
                        .is_err()
                    {
                        join_set.abort_all();
                        return Ok(());
                    }
                }
            }
        }

        if !batch.is_empty() {
            total_so_far += batch.len();
            if on_event
                .send(FuzzerSearchEvent::Items {
                    items: batch,
                    total_so_far,
                })
                .is_err()
            {
                return Ok(());
            }
        }
    }

    let _ = on_event.send(FuzzerSearchEvent::Done { total: total_so_far });
    Ok(())
}

async fn get_or_load_chunk_response(app: &tauri::AppHandle, chunk_id: i64, chunk_index: usize) -> Option<String> {
    // 1. Check in-memory LRU cache
    if let Some(chunk) = crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap().get(chunk_id) {
        return chunk.get(chunk_index).cloned();
    }

    // 2. Load blob from SQLite fuzzer_chunks
    if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        if let Ok(pool) = db_state.pool().await {
            if let Ok(Some(blob)) = crate::ares_utils::database::fuzzer::fetch_fuzzer_chunk_blob(&pool, chunk_id).await {
                if let Ok(responses) = crate::fuzzer::chunk_manager::decompress_chunk(&blob) {
                    let resp = responses.get(chunk_index).cloned();
                    crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap().insert(chunk_id, responses);
                    return resp;
                }
            }
        }
    }

    None
}

#[tauri::command]
pub async fn get_fuzzer_request_by_id(
    app: tauri::AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    request_id: String,
) -> Result<Option<FuzzerRequestRow>, String> {
    let key = run_key(selected_session, fuzz_history);
    let row_from_store = {
        let store = fuzz_store().lock().await;
        if let Some(run_data) = store.get(&key) {
            let row_opt = if let Some(&idx) = run_data.id_map.get(&request_id) {
                run_data.rows.get(idx).cloned()
            } else if let Ok(idx) = request_id.parse::<usize>() {
                run_data.rows.get(idx).cloned()
            } else {
                None
            };
            row_opt.map(|r| (r, run_data.config_snapshot.clone()))
        } else {
            None
        }
    };

    let reconstruct = |config_opt: &Option<crate::types::SessionPayload>, payload: Option<&str>, id: &str| -> Option<String> {
        config_opt.as_ref().map(|cfg| crate::fuzzer::utils::reconstruct_fuzzer_request(cfg, payload, id))
    };

    if let Some((mut row, config)) = row_from_store {
        let reconstructed = reconstruct(&config, row.payload.as_deref(), &row.fuzz_request_id);
        row.raw_request = reconstructed.clone();

        if row.response.is_none() && row.status == "completed" {
            if let Some(chunk_id) = row.chunk_id {
                let chunk_idx = row.chunk_index.unwrap_or(0) as usize;
                if let Some(raw_resp) = get_or_load_chunk_response(&app, chunk_id, chunk_idx).await {
                    row.response = Some(crate::types::ReqRes {
                        request: reconstructed.unwrap_or_default(),
                        response: raw_resp,
                        response_time: row.response_time_ms.unwrap_or(0),
                    });
                }
            }
        } else if let Some(ref mut resp) = row.response {
            if resp.request.is_empty() {
                resp.request = reconstructed.unwrap_or_default();
            }
        }
        return Ok(Some(row));
    }

    // Fallback to SQLite DB
    if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        if let Ok(pool) = db_state.pool().await {
            let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(
                &pool,
                selected_session as usize,
                fuzz_history as usize,
            )
            .await;

            let config_snapshot_str: Option<String> = sqlx::query_scalar(
                "SELECT config_snapshot FROM fuzzer_runs WHERE id = ?"
            )
            .bind(&run_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);

            let config_snapshot: Option<crate::types::SessionPayload> = config_snapshot_str
                .and_then(|s| serde_json::from_str(&s).ok());

            let row = if let Ok(idx) = request_id.parse::<i64>() {
                sqlx::query_as::<_, crate::ares_utils::database::fuzzer::FuzzerRequestDb>(
                    "SELECT * FROM fuzzer_requests WHERE (run_id = ? AND (id = ? OR sort_order = ?)) OR id = ?"
                )
                .bind(&run_id)
                .bind(&request_id)
                .bind(idx)
                .bind(&request_id)
                .fetch_optional(&pool)
                .await
                .unwrap_or(None)
            } else {
                sqlx::query_as::<_, crate::ares_utils::database::fuzzer::FuzzerRequestDb>(
                    "SELECT * FROM fuzzer_requests WHERE (run_id = ? AND id = ?) OR id = ?"
                )
                .bind(&run_id)
                .bind(&request_id)
                .bind(&request_id)
                .fetch_optional(&pool)
                .await
                .unwrap_or(None)
            };

            if let Some(r) = row {
                let reconstructed = reconstruct(&config_snapshot, r.payload.as_deref(), &r.id);

                let raw_resp_opt = if let Some(chunk_id) = r.chunk_id {
                    let chunk_idx = r.chunk_index.unwrap_or(0) as usize;
                    get_or_load_chunk_response(&app, chunk_id, chunk_idx).await
                } else {
                    None
                };

                let response = raw_resp_opt.map(|raw_resp| crate::types::ReqRes {
                    request: reconstructed.clone().unwrap_or_default(),
                    response: raw_resp,
                    response_time: r.response_time_ms.unwrap_or(0) as u128,
                });

                let status = if r.error_message.is_some() || r.connection_dropped {
                    "error".to_string()
                } else {
                    "completed".to_string()
                };

                return Ok(Some(FuzzerRequestRow {
                    id: r.sort_order as usize,
                    fuzz_request_id: r.id,
                    raw_request: reconstructed,
                    payload: r.payload,
                    response,
                    request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default(),
                    status,
                    error_message: r.error_message,
                    connection_dropped: r.connection_dropped,
                    worker_id: r.worker_id.map(|w| w as u32),
                    status_code: r.status_code.map(|c| c as u16),
                    response_length: r.response_length.map(|l| l as usize),
                    response_time_ms: r.response_time_ms.map(|t| t as u128),
                    chunk_id: r.chunk_id,
                    chunk_index: r.chunk_index,
                }));
            } else if let Some(cfg) = config_snapshot {
                // Request was not executed / completed on disk, reconstruct dynamically
                let sort_order = request_id.parse::<usize>().unwrap_or(0);
                let (target_id, payload) = crate::fuzzer::utils::generate_payload_for_sort_order(&cfg, sort_order);
                let reconstructed = Some(crate::fuzzer::utils::reconstruct_fuzzer_request(&cfg, payload.as_deref(), &target_id));

                let run_status: Option<String> = sqlx::query_scalar("SELECT status FROM fuzzer_runs WHERE id = ?")
                    .bind(&run_id)
                    .fetch_optional(&pool)
                    .await
                    .unwrap_or(None);
                let status = if run_status.as_deref() == Some("running") {
                    "pending"
                } else {
                    "cancelled"
                };

                return Ok(Some(FuzzerRequestRow {
                    id: sort_order,
                    fuzz_request_id: target_id,
                    raw_request: reconstructed,
                    payload,
                    response: None,
                    request_date: String::new(),
                    status: status.to_string(),
                    error_message: None,
                    connection_dropped: false,
                    worker_id: None,
                    status_code: None,
                    response_length: None,
                    response_time_ms: None,
                    chunk_id: None,
                    chunk_index: None,
                }));
            }
        }
    }
    Ok(None)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzProgress {
    pub selected_session: u32,
    pub fuzz_history: u32,
    pub completed: u32,
    pub total: u32,
    pub failed: u32,
    pub status: String,
    pub connection_dropped: bool,
}

pub struct FuzzRunConfig {
    pub url: String,
    pub delay_ms: u64,
    pub num_tasks: usize,
    pub selected_session: u32,
    pub fuzz_history: u32,
    /// When true, registers a cancel token for the whole run (initial fuzz only).
    pub register_cancel: bool,
    pub config_snapshot: Option<String>,
}

static FUZZ_CANCELLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static FUZZ_CONCURRENCY_CHANNELS: OnceLock<Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<usize>>>> = OnceLock::new();

const TIME_TO_UPDATE: Duration = Duration::from_millis(300);

fn cancellations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    FUZZ_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn concurrency_channels() -> &'static Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<usize>>> {
    FUZZ_CONCURRENCY_CHANNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn run_key(session: u32, history: u32) -> String {
    format!("{session}:{history}")
}

pub async fn is_run_active(session: u32, history: u32) -> bool {
    let key = run_key(session, history);
    cancellations().lock().await.contains_key(&key)
}

pub async fn register_run(session: u32, history: u32) -> Arc<AtomicBool> {
    let key = run_key(session, history);
    let flag = Arc::new(AtomicBool::new(false));
    cancellations().lock().await.insert(key, Arc::clone(&flag));
    flag
}

pub async fn register_concurrency_channel(session: u32, history: u32, tx: tokio::sync::mpsc::UnboundedSender<usize>) {
    let key = run_key(session, history);
    concurrency_channels().lock().await.insert(key, tx);
}

pub async fn get_concurrency_channel(session: u32, history: u32) -> Option<tokio::sync::mpsc::UnboundedSender<usize>> {
    concurrency_channels()
        .lock()
        .await
        .get(&run_key(session, history))
        .cloned()
}

async fn get_cancel_flag(session: u32, history: u32) -> Option<Arc<AtomicBool>> {
    cancellations()
        .lock()
        .await
        .get(&run_key(session, history))
        .cloned()
}

struct CleanupGuard {
    session: u32,
    history: u32,
    flag: Arc<AtomicBool>,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        let session = self.session;
        let history = self.history;
        let flag = Arc::clone(&self.flag);
        tokio::spawn(async move {
            let key = run_key(session, history);
            let mut map = cancellations().lock().await;
            if map
                .get(&key)
                .map(|f| Arc::ptr_eq(f, &flag))
                .unwrap_or(false)
            {
                map.remove(&key);
            }
            drop(map);
            concurrency_channels().lock().await.remove(&key);
        });
    }
}

fn is_connection_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("connection")
        || lower.contains("connect")
        || lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("broken pipe")
        || lower.contains("reset by peer")
        || lower.contains("forcibly closed")
        || lower.contains("network")
        || lower.contains("eof")
        || lower.contains("not connected")
        || lower.contains("url parsing failed")
}

fn emit_progress(
    app: &AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    completed: u32,
    total: u32,
    failed: u32,
    status: &str,
    connection_dropped: bool,
) {
    let _ = app.emit(
        "fuzz-progress",
        FuzzProgress {
            selected_session,
            fuzz_history,
            completed,
            total,
            failed,
            status: status.to_string(),
            connection_dropped,
        },
    );
}

enum ChunkWorkerMessage {
    Completed {
        id: String,
        sort_order: i64,
        payload: Option<String>,
        request_date: i64,
        raw_response: String,
        status_code: Option<i64>,
        response_length: i64,
        response_time_ms: i64,
        worker_id: Option<u32>,
    },
    Error {
        id: String,
        sort_order: i64,
        payload: Option<String>,
        request_date: i64,
        worker_id: Option<u32>,
        message: String,
        connection_dropped: bool,
    },
}

fn spawn_worker(
    worker_idx: usize,
    queue: Arc<std::sync::Mutex<VecDeque<FuzzTarget>>>,
    completed: Arc<AtomicU32>,
    failed: Arc<AtomicU32>,
    cancel: Arc<AtomicBool>,
    any_worker_dropped: Arc<AtomicBool>,
    target_workers: Arc<AtomicUsize>,
    active_workers: Arc<AtomicUsize>,
    url: String,
    delay_ms: u64,
    chunk_tx_w: tokio::sync::mpsc::Sender<ChunkWorkerMessage>,
    selected_session: u32,
    fuzz_history: u32,
    join_set: &mut tokio::task::JoinSet<()>,
    startup_jitter: bool,
) {
    let queue_clone = Arc::clone(&queue);
    let completed_clone = Arc::clone(&completed);
    let failed_clone = Arc::clone(&failed);
    let cancel_clone = Arc::clone(&cancel);
    let dropped_clone = Arc::clone(&any_worker_dropped);
    let target_workers_clone = Arc::clone(&target_workers);
    let active_workers_clone = Arc::clone(&active_workers);

    join_set.spawn(async move {
        // Jitter / staggering on startup to avoid thundering-herd SYN burst
        if startup_jitter {
            let startup_jitter_ms = ((worker_idx as u64) * 8).min(200) + (worker_idx as u64 % 7);
            if startup_jitter_ms > 0 {
                sleep(Duration::from_millis(startup_jitter_ms)).await;
            }
        }

        let mut conn: Option<HttpConnection> = None;
        let mut consecutive_conn_failures = 0usize;
        let mut retired_by_scaling = false;

        loop {
            if cancel_clone.load(Ordering::Relaxed) {
                break;
            }

            // Check dynamic scale-down
            let desired = target_workers_clone.load(Ordering::Relaxed);
            let mut current = active_workers_clone.load(Ordering::Relaxed);
            while current > desired {
                match active_workers_clone.compare_exchange_weak(
                    current,
                    current - 1,
                    Ordering::SeqCst,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        retired_by_scaling = true;
                        break;
                    }
                    Err(actual) => current = actual,
                }
            }
            if retired_by_scaling {
                break;
            }

            let target = {
                let mut q = match queue_clone.lock() {
                    Ok(g) => g,
                    Err(poisoned) => poisoned.into_inner(),
                };
                q.pop_front()
            };

            let target = match target {
                Some(t) => t,
                None => break, // Queue exhausted, worker finished!
            };

            // Lazy connection setup
            if conn.is_none() {
                match HttpConnection::new(&url).await {
                    Ok(c) => {
                        conn = Some(c);
                        consecutive_conn_failures = 0;
                    }
                    Err(e) => {
                        consecutive_conn_failures += 1;
                        tracing::warn!(
                            "Worker {} connect failed (attempt {}): {}",
                            worker_idx,
                            consecutive_conn_failures,
                            e
                        );

                        // Push target back to front of the queue so another worker or retry can process it
                        {
                            let mut q = match queue_clone.lock() {
                                Ok(g) => g,
                                Err(p) => p.into_inner(),
                            };
                            q.push_front(target);
                        }

                        if consecutive_conn_failures >= 5 {
                            dropped_clone.store(true, Ordering::Relaxed);
                            break;
                        }
                        sleep(Duration::from_millis(100 * consecutive_conn_failures as u64)).await;
                        continue;
                    }
                }
            }

            let c = conn.as_mut().unwrap();
            let dispatch_time = chrono::Utc::now().timestamp_millis();

            match c.send_request(target.request.as_bytes()).await {
                Ok(response) => {
                    consecutive_conn_failures = 0;
                    let raw_resp = response.as_text_lossy();
                    let status_code = crate::ares_utils::database::fuzzer::parse_status_code(&raw_resp);
                    let resp_len = raw_resp.len() as i64;
                    let resp_time = response.elapsed.as_millis();

                    update_store_completed(
                        selected_session,
                        fuzz_history,
                        &target.id,
                        dispatch_time,
                        status_code.map(|c| c as u16),
                        Some(resp_len as usize),
                        Some(resp_time),
                        Some(raw_resp.clone()),
                        Some(worker_idx as u32),
                    ).await;

                    let _ = chunk_tx_w.send(ChunkWorkerMessage::Completed {
                        id: target.id.clone(),
                        sort_order: target.sort_order as i64,
                        payload: target.payload.clone(),
                        request_date: dispatch_time,
                        raw_response: raw_resp,
                        status_code,
                        response_length: resp_len,
                        response_time_ms: resp_time as i64,
                        worker_id: Some(worker_idx as u32),
                    }).await;

                    completed_clone.fetch_add(1, Ordering::Relaxed);
                }
                Err(e) => {
                    let msg = e.to_string();
                    let is_conn_err = is_connection_error(&msg);

                    if is_conn_err {
                        // Attempt reconnect & retry
                        let mut reconnected_and_sent = false;
                        if c.reconnect().await.is_ok() {
                            let retry_dispatch_time = chrono::Utc::now().timestamp_millis();
                            match c.send_request(target.request.as_bytes()).await {
                                Ok(response) => {
                                    consecutive_conn_failures = 0;
                                    let raw_resp = response.as_text_lossy();
                                    let status_code = crate::ares_utils::database::fuzzer::parse_status_code(&raw_resp);
                                    let resp_len = raw_resp.len() as i64;
                                    let resp_time = response.elapsed.as_millis();

                                    update_store_completed(
                                        selected_session,
                                        fuzz_history,
                                        &target.id,
                                        retry_dispatch_time,
                                        status_code.map(|c| c as u16),
                                        Some(resp_len as usize),
                                        Some(resp_time),
                                        Some(raw_resp.clone()),
                                        Some(worker_idx as u32),
                                    ).await;

                                    let _ = chunk_tx_w.send(ChunkWorkerMessage::Completed {
                                        id: target.id.clone(),
                                        sort_order: target.sort_order as i64,
                                        payload: target.payload.clone(),
                                        request_date: retry_dispatch_time,
                                        raw_response: raw_resp,
                                        status_code,
                                        response_length: resp_len,
                                        response_time_ms: resp_time as i64,
                                        worker_id: Some(worker_idx as u32),
                                    }).await;

                                    completed_clone.fetch_add(1, Ordering::Relaxed);
                                    reconnected_and_sent = true;
                                }
                                Err(retry_err) => {
                                    tracing::warn!("Worker {} request retry failed: {}", worker_idx, retry_err);
                                }
                            }
                        }

                        if reconnected_and_sent {
                            if delay_ms > 0 {
                                sleep(Duration::from_millis(delay_ms)).await;
                            }
                            continue;
                        }

                        // Connection dropped: invalidate socket and push target back to front of queue
                        conn = None;
                        consecutive_conn_failures += 1;

                        {
                            let mut q = match queue_clone.lock() {
                                Ok(g) => g,
                                Err(p) => p.into_inner(),
                            };
                            q.push_front(target);
                        }

                        if consecutive_conn_failures >= 5 {
                            dropped_clone.store(true, Ordering::Relaxed);
                            break;
                        }
                        sleep(Duration::from_millis(100 * consecutive_conn_failures as u64)).await;
                        continue;
                    } else {
                        // Non-connection error (HTTP / parsing error)
                        update_store_error(selected_session, fuzz_history, &target.id, dispatch_time, msg.clone(), false, Some(worker_idx as u32)).await;

                        let _ = chunk_tx_w.send(ChunkWorkerMessage::Error {
                            id: target.id.clone(),
                            sort_order: target.sort_order as i64,
                            payload: target.payload.clone(),
                            request_date: dispatch_time,
                            worker_id: Some(worker_idx as u32),
                            message: msg.clone(),
                            connection_dropped: false,
                        }).await;

                        failed_clone.fetch_add(1, Ordering::Relaxed);
                        completed_clone.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }

            if delay_ms > 0 {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }

        if !retired_by_scaling {
            active_workers_clone.fetch_sub(1, Ordering::Relaxed);
        }
    });
}

/// Core dynamic worker execution engine using a shared producer-consumer queue.
async fn run_dynamic_fuzzer(
    app: AppHandle,
    config: FuzzRunConfig,
    targets: Vec<FuzzTarget>,
    initial_completed: u32,
    overall_total: u32,
    db_pool: Option<sqlx::SqlitePool>,
) {
    let selected_session = config.selected_session;
    let fuzz_history = config.fuzz_history;
    let total = overall_total;
    let run_id = format!("{}-{}", selected_session, fuzz_history);
    let num_workers = config.num_tasks.clamp(1, 100);
    let target_workers = Arc::new(AtomicUsize::new(num_workers));
    let active_workers = Arc::new(AtomicUsize::new(num_workers));

    let (concurrency_tx, mut concurrency_rx) = tokio::sync::mpsc::unbounded_channel::<usize>();
    register_concurrency_channel(selected_session, fuzz_history, concurrency_tx).await;

    if targets.is_empty() {
        emit_progress(&app, selected_session, fuzz_history, initial_completed, total, 0, "completed", false);
        return;
    }

    let cancel = if config.register_cancel {
        register_run(selected_session, fuzz_history).await
    } else {
        Arc::new(AtomicBool::new(false))
    };

    let _cleanup_guard = if config.register_cancel {
        Some(CleanupGuard {
            session: selected_session,
            history: fuzz_history,
            flag: Arc::clone(&cancel),
        })
    } else {
        None
    };

    let queue = Arc::new(std::sync::Mutex::new(VecDeque::from(targets)));
    let completed = Arc::new(AtomicU32::new(initial_completed));
    let failed = Arc::new(AtomicU32::new(0));
    let any_worker_dropped = Arc::new(AtomicBool::new(false));

    emit_progress(
        &app,
        selected_session,
        fuzz_history,
        initial_completed,
        total,
        0,
        "running",
        false,
    );

    // Periodic progress aggregator task
    let agg_app = app.clone();
    let agg_completed = Arc::clone(&completed);
    let agg_failed = Arc::clone(&failed);
    let agg_cancel = Arc::clone(&cancel);

    let aggregator_handle = tokio::spawn(async move {
        let mut ticker = interval(TIME_TO_UPDATE);
        loop {
            ticker.tick().await;
            let done = agg_completed.load(Ordering::Relaxed);
            let fail_count = agg_failed.load(Ordering::Relaxed);
            let is_cancelled = agg_cancel.load(Ordering::Relaxed);

            if is_cancelled {
                update_store_cancelled(selected_session, fuzz_history).await;
            }

            let status = if is_cancelled && done < total {
                "cancelled"
            } else {
                "running"
            };

            emit_progress(
                &agg_app,
                selected_session,
                fuzz_history,
                done,
                total,
                fail_count,
                status,
                false,
            );

            if is_cancelled || done >= total {
                break;
            }
        }
    });

    let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<ChunkWorkerMessage>(2048);
    let flusher_pool = db_pool.clone();
    let flusher_run_id = run_id.clone();
    let flusher_handle = tokio::spawn(async move {
        struct StatusChunkBuffer {
            responses: Vec<String>,
            meta: Vec<crate::ares_utils::database::fuzzer::FuzzerCompletedItemMeta>,
            total_bytes: usize,
            created_at: std::time::Instant,
        }

        impl StatusChunkBuffer {
            fn new(capacity: usize) -> Self {
                Self {
                    responses: Vec::with_capacity(capacity),
                    meta: Vec::with_capacity(capacity),
                    total_bytes: 0,
                    created_at: std::time::Instant::now(),
                }
            }

            fn push(
                &mut self,
                raw_response: String,
                item: crate::ares_utils::database::fuzzer::FuzzerCompletedItemMeta,
            ) {
                self.total_bytes += raw_response.len();
                self.meta.push(item);
                self.responses.push(raw_response);
            }

            fn is_empty(&self) -> bool {
                self.responses.is_empty()
            }
        }

        use crate::fuzzer::chunk_manager::{
            target_byte_capacity_for_status, target_chunk_capacity_for_status,
        };

        async fn do_flush_status(
            pool: &sqlx::SqlitePool,
            run_id: &str,
            status_code: i64,
            buf: &mut StatusChunkBuffer,
        ) {
            if buf.is_empty() {
                return;
            }
            let resps = std::mem::take(&mut buf.responses);
            let metas = std::mem::take(&mut buf.meta);
            buf.total_bytes = 0;
            buf.created_at = std::time::Instant::now();

            if let Ok(compressed) = crate::fuzzer::chunk_manager::compress_chunk(&resps) {
                let total_bytes: i64 = resps.iter().map(|s| s.len() as i64).sum();

                // Build filtered FTS text: only include text-based responses, capping body at 32 KB
                let mut fts_text = String::new();
                for r in &resps {
                    if crate::ares_utils::content_filter::is_text_based_response(r) {
                        let (headers, body) = crate::ares_utils::parse::split_message(r);
                        let body_limit = body.len().min(32_768);
                        fts_text.push_str(headers);
                        fts_text.push_str("\r\n\r\n");
                        fts_text.push_str(&body[..body_limit]);
                        fts_text.push('\n');
                    }
                }

                let fts_opt = if fts_text.is_empty() {
                    None
                } else {
                    Some(fts_text.as_str())
                };

                if let Ok(chunk_id) = crate::ares_utils::database::fuzzer::insert_fuzzer_chunk_and_update_requests(
                    pool,
                    run_id,
                    status_code,
                    &compressed,
                    total_bytes,
                    &metas,
                    fts_opt,
                ).await {
                    crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap().insert(chunk_id, resps);
                }
            }
        }

        let mut status_buffers: std::collections::HashMap<i64, StatusChunkBuffer> = std::collections::HashMap::new();
        let mut ticker = interval(Duration::from_millis(500));
        const TIMEOUT_FLUSH_DURATION: Duration = Duration::from_millis(500);

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if let Some(ref pool) = flusher_pool {
                        for (&code, buf) in status_buffers.iter_mut() {
                            if !buf.is_empty() && buf.created_at.elapsed() >= TIMEOUT_FLUSH_DURATION {
                                do_flush_status(pool, &flusher_run_id, code, buf).await;
                            }
                        }
                    }
                }
                msg = chunk_rx.recv() => {
                    match msg {
                        Some(ChunkWorkerMessage::Completed { id, sort_order, payload, request_date, raw_response, status_code, response_length, response_time_ms, worker_id }) => {
                            let code = status_code.unwrap_or(0);
                            let item = crate::ares_utils::database::fuzzer::FuzzerCompletedItemMeta {
                                id,
                                sort_order,
                                payload,
                                request_date,
                                status_code,
                                response_length,
                                response_time_ms,
                                worker_id,
                            };

                            let cap = target_chunk_capacity_for_status(code);
                            let byte_cap = target_byte_capacity_for_status(code);

                            let buf = status_buffers
                                .entry(code)
                                .or_insert_with(|| StatusChunkBuffer::new(cap));
                            buf.push(raw_response, item);

                            if buf.responses.len() >= cap || buf.total_bytes >= byte_cap {
                                if let Some(ref pool) = flusher_pool {
                                    do_flush_status(pool, &flusher_run_id, code, buf).await;
                                }
                            }
                        }
                        Some(ChunkWorkerMessage::Error { id, sort_order, payload, request_date, worker_id, message, connection_dropped }) => {
                            if let Some(ref pool) = flusher_pool {
                                let _ = crate::ares_utils::database::fuzzer::insert_fuzzer_request_error(
                                    pool,
                                    &flusher_run_id,
                                    &id,
                                    sort_order,
                                    payload.as_deref(),
                                    request_date,
                                    worker_id,
                                    &message,
                                    connection_dropped,
                                ).await;
                            }
                        }
                        None => {
                            break;
                        }
                    }
                }
            }
        }

        if let Some(ref pool) = flusher_pool {
            for (&code, buf) in status_buffers.iter_mut() {
                if !buf.is_empty() {
                    do_flush_status(pool, &flusher_run_id, code, buf).await;
                }
            }
        }
    });

    // Spawn dynamic consumer workers using JoinSet and dynamic supervisor
    let mut join_set = tokio::task::JoinSet::new();

    for worker_idx in 0..num_workers {
        spawn_worker(
            worker_idx,
            Arc::clone(&queue),
            Arc::clone(&completed),
            Arc::clone(&failed),
            Arc::clone(&cancel),
            Arc::clone(&any_worker_dropped),
            Arc::clone(&target_workers),
            Arc::clone(&active_workers),
            config.url.clone(),
            config.delay_ms,
            chunk_tx.clone(),
            selected_session,
            fuzz_history,
            &mut join_set,
            true,
        );
    }

    let mut next_worker_id = num_workers;

    loop {
        tokio::select! {
            Some(new_threads) = concurrency_rx.recv() => {
                let clamped = new_threads.clamp(1, 100);
                target_workers.store(clamped, Ordering::Relaxed);
                let current_active = active_workers.load(Ordering::Relaxed);
                if clamped > current_active {
                    let to_spawn = clamped - current_active;
                    active_workers.fetch_add(to_spawn, Ordering::Relaxed);
                    for _ in 0..to_spawn {
                        let wid = next_worker_id;
                        next_worker_id += 1;
                        spawn_worker(
                            wid,
                            Arc::clone(&queue),
                            Arc::clone(&completed),
                            Arc::clone(&failed),
                            Arc::clone(&cancel),
                            Arc::clone(&any_worker_dropped),
                            Arc::clone(&target_workers),
                            Arc::clone(&active_workers),
                            config.url.clone(),
                            config.delay_ms,
                            chunk_tx.clone(),
                            selected_session,
                            fuzz_history,
                            &mut join_set,
                            false,
                        );
                    }
                }
            }
            res = join_set.join_next() => {
                match res {
                    Some(_) => {
                        if join_set.is_empty() {
                            break;
                        }
                    }
                    None => {
                        break;
                    }
                }
            }
        }
    }

    drop(chunk_tx);
    let _ = flusher_handle.await;
    aggregator_handle.abort();

    let final_completed = completed.load(Ordering::Relaxed);
    let final_failed = failed.load(Ordering::Relaxed);
    let worker_failed_conn = any_worker_dropped.load(Ordering::Relaxed);
    let cancelled = cancel.load(Ordering::Relaxed);
    let queue_has_remaining = {
        let q = match queue.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        !q.is_empty()
    };

    if cancelled {
        update_store_cancelled(selected_session, fuzz_history).await;
    }

    let is_conn_dropped = !cancelled && (worker_failed_conn || queue_has_remaining || final_completed < total);
    let status = if cancelled && final_completed < total {
        "cancelled"
    } else if is_conn_dropped {
        "connection_dropped"
    } else {
        "completed"
    };

    let conn_dropped = status == "connection_dropped";

    if let Some(ref pool) = db_pool {
        let now = chrono::Utc::now().timestamp_millis();
        let _ = sqlx::query(
            "UPDATE fuzzer_runs SET status = ?, completed = ?, failed = ?, connection_dropped = ?, finished_at = ? WHERE id = ?"
        )
        .bind(status)
        .bind(final_completed as i64)
        .bind(final_failed as i64)
        .bind(conn_dropped)
        .bind(now)
        .bind(&run_id)
        .execute(pool)
        .await;
    }

    invalidate_fuzzer_search_cache(selected_session, fuzz_history).await;

    emit_progress(
        &app,
        selected_session,
        fuzz_history,
        final_completed.min(total),
        total,
        final_failed,
        status,
        conn_dropped,
    );
}

pub async fn run_fuzz_targets(app: AppHandle, config: FuzzRunConfig, targets: Vec<FuzzTarget>) {
    let total = targets.len() as u32;
    let selected_session = config.selected_session;
    let fuzz_history = config.fuzz_history;

    let parsed_snapshot: Option<crate::types::SessionPayload> = config.config_snapshot
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());

    init_fuzz_store(selected_session, fuzz_history, &targets, parsed_snapshot).await;

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    let run_id = format!("{}-{}", selected_session, fuzz_history);

    if let Some(ref pool) = db_pool {
        let real_project_id: String = match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(pool)
            .await
        {
            Ok(Some(pid)) => pid,
            _ => "default".to_string(),
        };

        let session_id: String = match sqlx::query_scalar::<_, String>(
            "SELECT id FROM fuzzer_sessions ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
        )
        .bind(selected_session as i64)
        .fetch_optional(pool)
        .await {
            Ok(Some(s_id)) => s_id,
            _ => {
                let new_id = uuid::Uuid::new_v4().to_string();
                let now = chrono::Utc::now().timestamp_millis();
                let _ = sqlx::query(
                    "INSERT INTO fuzzer_sessions (id, project_id, name, target_url, raw_request, sort_order, created_at)
                     VALUES (?, ?, ?, ?, '', ?, ?)"
                )
                .bind(&new_id)
                .bind(&real_project_id)
                .bind(format!("Session {}", selected_session + 1))
                .bind(&config.url)
                .bind(selected_session as i64)
                .bind(now)
                .execute(pool)
                .await;
                new_id
            }
        };

        let now = chrono::Utc::now().timestamp_millis();
        if let Some(ref snapshot_str) = config.config_snapshot {
            let _ = sqlx::query(
                "INSERT INTO fuzzer_runs (id, session_id, config_snapshot, status, total, completed, failed, completed_base, connection_dropped, started_at)
                 VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0, ?)
                 ON CONFLICT(id) DO UPDATE SET status = 'running', total = excluded.total, failed = 0, config_snapshot = excluded.config_snapshot, started_at = excluded.started_at"
            )
            .bind(&run_id)
            .bind(&session_id)
            .bind(snapshot_str)
            .bind(total as i64)
            .bind(now)
            .execute(pool)
            .await;
        } else {
            let default_snapshot = serde_json::json!({
                "numThreads": config.num_tasks,
                "delayMs": config.delay_ms,
                "metadata": {
                    "targetUrl": config.url,
                    "urlIsValid": !config.url.is_empty(),
                },
                "parameters": [],
                "rawRequest": "",
            }).to_string();

            let _ = sqlx::query(
                "INSERT INTO fuzzer_runs (id, session_id, config_snapshot, status, total, completed, failed, completed_base, connection_dropped, started_at)
                 VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0, ?)
                 ON CONFLICT(id) DO UPDATE SET status = 'running', total = excluded.total, failed = 0, started_at = excluded.started_at"
            )
            .bind(&run_id)
            .bind(&session_id)
            .bind(&default_snapshot)
            .bind(total as i64)
            .bind(now)
            .execute(pool)
            .await;
        }
    }

    run_dynamic_fuzzer(app, config, targets, 0, total, db_pool).await;
}

#[tauri::command]
pub async fn cancel_fuzzing(
    app: AppHandle,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<(), String> {
    if let Some(flag) = get_cancel_flag(selected_session, fuzz_history).await {
        flag.store(true, Ordering::Relaxed);
        update_store_cancelled(selected_session, fuzz_history).await;
        invalidate_fuzzer_search_cache(selected_session, fuzz_history).await;

        let key = run_key(selected_session, fuzz_history);
        let (completed, total, failed) = {
            let store = fuzz_store().lock().await;
            if let Some(run_data) = store.get(&key) {
                let completed = run_data
                    .rows
                    .iter()
                    .filter(|r| r.status == "completed" || r.status == "error")
                    .count() as u32;
                let failed = run_data
                    .rows
                    .iter()
                    .filter(|r| r.status == "error")
                    .count() as u32;
                let total = run_data.rows.len() as u32;
                (completed, total, failed)
            } else {
                (0, 0, 0)
            }
        };

        if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
            if let Ok(pool) = db_state.pool().await {
                let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(
                    &pool,
                    selected_session as usize,
                    fuzz_history as usize,
                )
                .await;
                let now = chrono::Utc::now().timestamp_millis();
                let _ = sqlx::query(
                    "UPDATE fuzzer_runs SET status = 'cancelled', completed = ?, failed = ?, finished_at = ? WHERE id = ?"
                )
                .bind(completed as i64)
                .bind(failed as i64)
                .bind(now)
                .bind(&run_id)
                .execute(&pool)
                .await;
            }
        }

        emit_progress(
            &app,
            selected_session,
            fuzz_history,
            completed,
            total,
            failed,
            "cancelled",
            false,
        );

        Ok(())
    } else {
        Err("No active fuzz run found".to_string())
    }
}

#[tauri::command]
pub async fn set_fuzzer_threads(
    app: AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    num_threads: usize,
) -> Result<(), String> {
    let clamped = num_threads.clamp(1, 100);

    // 1. If actively running, notify the supervisor
    if let Some(tx) = get_concurrency_channel(selected_session, fuzz_history).await {
        let _ = tx.send(clamped);
    }

    // 2. Update in-memory fuzz_store if exists
    let key = run_key(selected_session, fuzz_history);
    {
        let mut store = fuzz_store().lock().await;
        if let Some(run_data) = store.get_mut(&key) {
            if let Some(ref mut snap) = run_data.config_snapshot {
                snap.num_threads = Some(clamped);
            }
        }
    }

    // 3. Persist in database
    if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        if let Ok(pool) = db_state.pool().await {
            let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(
                &pool,
                selected_session as usize,
                fuzz_history as usize,
            )
            .await;

            // Update config_snapshot in fuzzer_runs
            if let Ok(Some(existing_snap)) = sqlx::query_scalar::<_, String>(
                "SELECT config_snapshot FROM fuzzer_runs WHERE id = ?"
            )
            .bind(&run_id)
            .fetch_optional(&pool)
            .await {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&existing_snap) {
                    json["numThreads"] = serde_json::json!(clamped);
                    let updated_str = json.to_string();
                    let _ = sqlx::query("UPDATE fuzzer_runs SET config_snapshot = ? WHERE id = ?")
                        .bind(&updated_str)
                        .bind(&run_id)
                        .execute(&pool)
                        .await;
                }
            }

            // Also update fuzzer_sessions so future runs inherit the thread count
            let _ = sqlx::query(
                "UPDATE fuzzer_sessions SET num_threads = ? WHERE id = (
                    SELECT session_id FROM fuzzer_runs WHERE id = ?
                )"
            )
            .bind(clamped as i64)
            .bind(&run_id)
            .execute(&pool)
            .await;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn resend_fuzz_request(
    app: AppHandle,
    url: String,
    target: FuzzTarget,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<(), String> {
    let id = target.id.clone();
    update_store_pending(selected_session, fuzz_history, &[id.clone()]).await;

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    let run_id = format!("{}-{}", selected_session, fuzz_history);

    tokio::spawn(async move {
        let dispatch_time = chrono::Utc::now().timestamp_millis();
        let conn_result = HttpConnection::new(&url).await;

        match conn_result {
            Ok(mut conn) => {
                match conn.send_request(target.request.as_bytes()).await {
                    Ok(response) => {
                        let raw_resp = response.as_text_lossy();
                        let status_code = crate::ares_utils::database::fuzzer::parse_status_code(&raw_resp);
                        let resp_len = raw_resp.len() as usize;
                        let resp_time = response.elapsed.as_millis();

                        update_store_completed(
                            selected_session,
                            fuzz_history,
                            &target.id,
                            dispatch_time,
                            status_code.map(|c| c as u16),
                            Some(resp_len),
                            Some(resp_time),
                            Some(raw_resp.clone()),
                            Some(0),
                        ).await;

                        if let Some(ref pool) = db_pool {
                            let item = crate::ares_utils::database::fuzzer::FuzzerCompletedItemMeta {
                                id: target.id.clone(),
                                sort_order: target.sort_order as i64,
                                payload: target.payload.clone(),
                                request_date: dispatch_time,
                                status_code: status_code.map(|c| c as i64),
                                response_length: resp_len as i64,
                                response_time_ms: resp_time as i64,
                                worker_id: Some(0),
                            };
                            let code = status_code.unwrap_or(0);
                            if let Ok(compressed) = crate::fuzzer::chunk_manager::compress_chunk(&[raw_resp.clone()]) {
                                let fts_opt = if crate::ares_utils::content_filter::is_text_based_response(&raw_resp) {
                                    let (headers, body) = crate::ares_utils::parse::split_message(&raw_resp);
                                    let body_limit = body.len().min(32_768);
                                    let mut fts_text = String::new();
                                    fts_text.push_str(headers);
                                    fts_text.push_str("\r\n\r\n");
                                    fts_text.push_str(&body[..body_limit]);
                                    Some(fts_text)
                                } else {
                                    None
                                };
                                if let Ok(chunk_id) = crate::ares_utils::database::fuzzer::insert_fuzzer_chunk_and_update_requests(
                                    pool,
                                    &run_id,
                                    code,
                                    &compressed,
                                    raw_resp.len() as i64,
                                    &[item],
                                    fts_opt.as_deref(),
                                ).await {
                                    crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap().insert(chunk_id, vec![raw_resp]);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        let is_conn_err = is_connection_error(&msg);
                        update_store_error(
                            selected_session,
                            fuzz_history,
                            &target.id,
                            dispatch_time,
                            msg.clone(),
                            is_conn_err,
                            Some(0),
                        ).await;

                        if let Some(ref pool) = db_pool {
                            let _ = crate::ares_utils::database::fuzzer::insert_fuzzer_request_error(
                                pool,
                                &run_id,
                                &target.id,
                                target.sort_order as i64,
                                target.payload.as_deref(),
                                dispatch_time,
                                Some(0),
                                &msg,
                                is_conn_err,
                            ).await;
                        }
                    }
                }
            }
            Err(e) => {
                let msg = e.to_string();
                update_store_error(
                    selected_session,
                    fuzz_history,
                    &target.id,
                    dispatch_time,
                    msg.clone(),
                    true,
                    Some(0),
                ).await;

                if let Some(ref pool) = db_pool {
                    let _ = crate::ares_utils::database::fuzzer::insert_fuzzer_request_error(
                        pool,
                        &run_id,
                        &target.id,
                        target.sort_order as i64,
                        target.payload.as_deref(),
                        dispatch_time,
                        Some(0),
                        &msg,
                        true,
                    ).await;
                }
            }
        }

        // Recalculate true stats for the whole run from the in-memory store (or DB)
        let key = run_key(selected_session, fuzz_history);
        let store = fuzz_store().lock().await;
        let (completed, failed, total, status) = if let Some(run_data) = store.get(&key) {
            let completed = run_data.rows.iter().filter(|r| r.status == "completed").count() as u32;
            let failed = run_data.rows.iter().filter(|r| r.status == "error").count() as u32;
            let total = run_data.rows.len() as u32;
            let has_pending = run_data.rows.iter().any(|r| r.status == "pending");

            let status = if completed == total {
                "completed"
            } else if !has_pending && (failed + completed == total) {
                "completed"
            } else {
                "cancelled"
            };
            (completed, failed, total, status)
        } else if let Some(ref pool) = db_pool {
            let total_count = sqlx::query_scalar::<_, i64>(
                "SELECT total FROM fuzzer_runs WHERE id = ?"
            )
            .bind(&run_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0) as u32;

            let completed_count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM fuzzer_requests WHERE run_id = ? AND status_code IS NOT NULL"
            )
            .bind(&run_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0) as u32;

            let failed_count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM fuzzer_requests WHERE run_id = ? AND (error_message IS NOT NULL OR connection_dropped = 1)"
            )
            .bind(&run_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0) as u32;

            let status = if total_count > 0 && (completed_count + failed_count >= total_count) {
                "completed"
            } else {
                "cancelled"
            };
            (completed_count, failed_count, total_count, status)
        } else {
            (0, 0, 0, "cancelled")
        };
        drop(store);

        if status == "cancelled" {
            update_store_cancelled(selected_session, fuzz_history).await;
        }

        if let Some(ref pool) = db_pool {
            let now = chrono::Utc::now().timestamp_millis();
            let _ = sqlx::query(
                "UPDATE fuzzer_runs SET status = ?, completed = ?, failed = ?, finished_at = ? WHERE id = ?"
            )
            .bind(status)
            .bind(completed as i64)
            .bind(failed as i64)
            .bind(now)
            .bind(&run_id)
            .execute(pool)
            .await;
        }

        emit_progress(
            &app,
            selected_session,
            fuzz_history,
            completed,
            total,
            failed,
            status,
            false,
        );

        invalidate_fuzzer_search_cache(selected_session, fuzz_history).await;
    });

    Ok(())
}

async fn get_remaining_or_failed_targets(
    app: &AppHandle,
    session: u32,
    history: u32,
) -> (Vec<FuzzTarget>, u32, u32, u32, Option<String>) {
    let key = run_key(session, history);
    let store = fuzz_store().lock().await;
    let mut targets = Vec::new();
    let mut completed_count = 0;
    let mut failed_count = 0;
    let mut total_count = 0;
    let mut config_snapshot_str = None;

    if let Some(run_data) = store.get(&key) {
        total_count = run_data.rows.len() as u32;
        let config = run_data.config_snapshot.clone();
        config_snapshot_str = config.as_ref().and_then(|c| serde_json::to_string(c).ok());
        for row in run_data.rows.iter() {
            if row.status == "completed" {
                completed_count += 1;
            } else if row.status == "error" || row.connection_dropped || row.status == "cancelled" || row.status == "pending" {
                if row.status == "error" {
                    failed_count += 1;
                }
                let raw_req = if let Some(ref cfg) = config {
                    crate::fuzzer::utils::reconstruct_fuzzer_request(cfg, row.payload.as_deref(), &row.fuzz_request_id)
                } else {
                    row.raw_request.clone().unwrap_or_default()
                };
                targets.push(FuzzTarget {
                    id: row.fuzz_request_id.clone(),
                    sort_order: row.id,
                    request: raw_req,
                    payload: row.payload.clone(),
                });
            }
        }
    } else if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        if let Ok(pool) = db_state.pool().await {
            let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(&pool, session as usize, history as usize).await;
            let run_info: Option<(i64, Option<String>)> = sqlx::query_as(
                "SELECT total, config_snapshot FROM fuzzer_runs WHERE id = ?"
            )
            .bind(&run_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);

            if let Some((total_i64, db_snapshot)) = run_info {
                total_count = total_i64 as u32;
                config_snapshot_str = db_snapshot;
                let config_snapshot: Option<crate::types::SessionPayload> = config_snapshot_str
                    .as_ref()
                    .and_then(|s| serde_json::from_str(s).ok());

                let completed_set = crate::ares_utils::database::fuzzer::fetch_completed_sort_orders(&pool, &run_id).await.unwrap_or_default();
                completed_count = completed_set.len() as u32;

                if let Some(ref cfg) = config_snapshot {
                    for idx in 0..total_count as usize {
                        if !completed_set.contains(&(idx as i64)) {
                            let (target_id, payload) = crate::fuzzer::utils::generate_payload_for_sort_order(cfg, idx);
                            let req = crate::fuzzer::utils::reconstruct_fuzzer_request(cfg, payload.as_deref(), &target_id);
                            targets.push(FuzzTarget {
                                id: target_id,
                                sort_order: idx,
                                request: req,
                                payload,
                            });
                        }
                    }
                }
            }
        }
    }

    (targets, completed_count, failed_count, total_count, config_snapshot_str)
}

#[tauri::command]
pub async fn resend_failed_fuzz_requests(
    app: AppHandle,
    url: String,
    selected_session: u32,
    fuzz_history: u32,
    delay_ms: u64,
    already_completed: u32,
    overall_total: u32,
) -> Result<(), String> {
    let (targets, completed_count, _failed_count, total_count, config_snapshot_str) =
        get_remaining_or_failed_targets(&app, selected_session, fuzz_history).await;

    if targets.is_empty() {
        return Err("No targets to resend".to_string());
    }
    let ids: Vec<String> = targets.iter().map(|t| t.id.clone()).collect();
    update_store_pending(selected_session, fuzz_history, &ids).await;
    invalidate_fuzzer_search_cache(selected_session, fuzz_history).await;

    let total = if overall_total > 0 { overall_total } else { total_count };
    let completed = if already_completed > 0 { already_completed } else { completed_count };

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    if let Some(ref pool) = db_pool {
        let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(
            pool,
            selected_session as usize,
            fuzz_history as usize,
        ).await;
        let _ = sqlx::query("UPDATE fuzzer_runs SET status = 'running' WHERE id = ?")
            .bind(&run_id)
            .execute(pool)
            .await;
    }

    let parsed_threads = config_snapshot_str
        .as_ref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.get("numThreads").and_then(|t| t.as_u64()))
        .map(|t| t as usize)
        .unwrap_or(4);

    let config = FuzzRunConfig {
        url,
        delay_ms,
        num_tasks: parsed_threads,
        selected_session,
        fuzz_history,
        register_cancel: true,
        config_snapshot: config_snapshot_str,
    };

    tokio::spawn(async move {
        run_dynamic_fuzzer(app, config, targets, completed, total, db_pool).await;
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_live_store_regex_filter() {
        let targets = vec![
            FuzzTarget {
                id: "0-0".to_string(),
                sort_order: 0,
                request: "GET /0 HTTP/1.1\r\n\r\n".to_string(),
                payload: Some("0".to_string()),
            },
            FuzzTarget {
                id: "0-1".to_string(),
                sort_order: 1,
                request: "GET /1 HTTP/1.1\r\n\r\n".to_string(),
                payload: Some("1".to_string()),
            },
        ];

        init_fuzz_store(999, 999, &targets, None).await;

        update_store_completed(
            999,
            999,
            "0-0",
            1000,
            Some(200),
            Some(100),
            Some(50),
            Some("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_string()),
            Some(0),
        ).await;

        update_store_completed(
            999,
            999,
            "0-1",
            1005,
            Some(404),
            Some(50),
            Some(30),
            Some("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_string()),
            Some(0),
        ).await;

        let key = run_key(999, 999);
        let store = fuzz_store().lock().await;
        assert!(store.contains_key(&key));
        let run_data = store.get(&key).unwrap();
        let target_rows: Vec<&FuzzerRequestRow> = run_data.rows.iter().filter(|r| r.status == "completed" || r.status == "error").collect();
        assert_eq!(target_rows.len(), 2);

        let expr = crate::ares_utils::httpql::parse_httpql("resp.raw.regex:.404.").unwrap().unwrap();
        let filtered: Vec<&FuzzerRequestRow> = target_rows.into_iter().filter(|r| {
            let raw_resp_str = r.response.as_ref().map(|resp| resp.response.as_str());
            let item = crate::ares_utils::httpql::FuzzerEvaluableItem {
                id: r.id as u32,
                method: "GET",
                host: "example.com",
                path: "/",
                query: None,
                ext: None,
                status_code: r.status_code.map(|c| c as i64).unwrap_or(0),
                response_length: r.response_length.map(|l| l as i64).unwrap_or(0),
                response_time_ms: r.response_time_ms.map(|t| t as i64).unwrap_or(0),
                sent_at_ms: chrono::DateTime::parse_from_rfc3339(&r.request_date)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or(0),
                state: &r.status,
                is_https: false,
                raw_request: None,
                raw_response: raw_resp_str,
                payload: r.payload.as_deref(),
            };
            expr.evaluate(&item)
        }).collect();

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].fuzz_request_id, "0-1");
    }

    #[tokio::test]
    async fn test_show_uncompleted_in_store() {
        let targets = vec![
            FuzzTarget {
                id: "10-0".to_string(),
                sort_order: 0,
                request: "GET /0 HTTP/1.1\r\n\r\n".to_string(),
                payload: Some("admin".to_string()),
            },
            FuzzTarget {
                id: "10-1".to_string(),
                sort_order: 1,
                request: "GET /1 HTTP/1.1\r\n\r\n".to_string(),
                payload: Some("guest".to_string()),
            },
            FuzzTarget {
                id: "10-2".to_string(),
                sort_order: 2,
                request: "GET /2 HTTP/1.1\r\n\r\n".to_string(),
                payload: Some("root".to_string()),
            },
        ];

        init_fuzz_store(888, 888, &targets, None).await;

        // Complete only the first target
        update_store_completed(
            888,
            888,
            "10-0",
            2000,
            Some(200),
            Some(120),
            Some(25),
            Some("HTTP/1.1 200 OK\r\n\r\n".to_string()),
            Some(0),
        ).await;

        let key = run_key(888, 888);
        let store = fuzz_store().lock().await;
        let run_data = store.get(&key).unwrap();

        // show_uncompleted = false -> only completed/error
        let completed_only: Vec<&FuzzerRequestRow> = run_data
            .rows
            .iter()
            .filter(|r| r.status == "completed" || r.status == "error")
            .collect();
        assert_eq!(completed_only.len(), 1);
        assert_eq!(completed_only[0].fuzz_request_id, "10-0");

        // show_uncompleted = true -> all 3
        let all_rows: Vec<&FuzzerRequestRow> = run_data.rows.iter().collect();
        assert_eq!(all_rows.len(), 3);
        assert_eq!(all_rows[0].status, "completed");
        assert_eq!(all_rows[1].status, "pending");
        assert_eq!(all_rows[2].status, "pending");
        drop(store);

        // Cancel the run -> remaining pending become cancelled
        update_store_cancelled(888, 888).await;
        let store2 = fuzz_store().lock().await;
        let run_data2 = store2.get(&key).unwrap();
        assert_eq!(run_data2.rows[0].status, "completed");
        assert_eq!(run_data2.rows[1].status, "cancelled");
        assert_eq!(run_data2.rows[2].status, "cancelled");
    }

    #[tokio::test]
    async fn test_show_uncompleted_with_lazy_fuzzer_response_filter() {
        let q_404 = crate::ares_utils::httpql::parse_httpql("resp.raw.regex:.404.").unwrap().unwrap();
        let q_pending = crate::ares_utils::httpql::parse_httpql("resp.state:\"pending\"").unwrap().unwrap();

        // 1. Completed 404 item
        let item_404 = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
            0,
            404,
            50,
            20,
            1000,
            "completed",
            Some("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"),
            Some("payload-0"),
            "0",
            None,
            "GET",
            "example.com",
            "/",
            false,
        );

        // 2. Completed 200 item
        let item_200 = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
            1,
            200,
            150,
            15,
            1001,
            "completed",
            Some("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"),
            Some("payload-1"),
            "1",
            None,
            "GET",
            "example.com",
            "/",
            false,
        );

        // 3. Uncompleted pending item (no response)
        let item_pending = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
            2,
            0,
            0,
            0,
            0,
            "pending",
            None,
            Some("payload-2"),
            "2",
            None,
            "GET",
            "example.com",
            "/",
            false,
        );

        // resp.raw.regex:.404. should only match item_404
        assert!(q_404.evaluate(&item_404));
        assert!(!q_404.evaluate(&item_200));
        assert!(!q_404.evaluate(&item_pending));

        // resp.state:"pending" should only match item_pending
        assert!(!q_pending.evaluate(&item_404));
        assert!(!q_pending.evaluate(&item_200));
        assert!(q_pending.evaluate(&item_pending));
    }

    #[test]
    fn test_make_uncompleted_request_row() {
        let row = make_uncompleted_request_row(5, None, "cancelled");
        assert_eq!(row.id, 5);
        assert_eq!(row.status, "cancelled");
        assert_eq!(row.fuzz_request_id, "5");
        assert_eq!(row.payload, None);
        assert_eq!(row.status_code, None);

        let row_running = make_uncompleted_request_row(10, None, "running");
        assert_eq!(row_running.id, 10);
        assert_eq!(row_running.status, "pending");
    }
}

