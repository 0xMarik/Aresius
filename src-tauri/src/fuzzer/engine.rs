use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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

pub async fn init_fuzz_store(
    session: u32,
    history: u32,
    targets: &[FuzzTarget],
    config_snapshot: Option<crate::types::SessionPayload>,
) {
    let key = run_key(session, history);
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
    let show_uncompleted_val = show_uncompleted.unwrap_or(false);
    let parsed_httpql = search_query
        .as_deref()
        .and_then(|q| if q.trim().is_empty() { None } else { Some(q) })
        .and_then(|q| crate::ares_utils::httpql::parse_httpql(q).ok().flatten());

    let key = run_key(selected_session, fuzz_history);
    let store = fuzz_store().lock().await;
    if parsed_httpql.is_none() && store.contains_key(&key) {
        let run_data = store.get(&key).unwrap();
        let target_rows: Vec<&FuzzerRequestRow> = if show_uncompleted_val {
            run_data.rows.iter().collect()
        } else {
            run_data.rows.iter().filter(|r| r.status == "completed" || r.status == "error").collect()
        };

        let total = target_rows.len();
        let start = offset.min(total);
        let end = (offset + limit).min(total);

        let is_desc = sort_order
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case("desc"))
            .unwrap_or(false);

        let items: Vec<FuzzerRequestRow> = match sort_by.as_deref() {
            Some("statusCode") | Some("responseCode") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let code_a = target_rows[a]
                        .response
                        .as_ref()
                        .and_then(|r| crate::ares_utils::database::fuzzer::parse_status_code(&r.response));
                    let code_b = target_rows[b]
                        .response
                        .as_ref()
                        .and_then(|r| crate::ares_utils::database::fuzzer::parse_status_code(&r.response));
                    let cmp = match (code_a, code_b) {
                        (Some(x), Some(y)) => x.cmp(&y),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.cmp(&b),
                    };
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| (*target_rows[i]).clone()).collect()
            }
            Some("duration") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let dur_a = target_rows[a].response.as_ref().map(|r| r.response_time);
                    let dur_b = target_rows[b].response.as_ref().map(|r| r.response_time);
                    let cmp = match (dur_a, dur_b) {
                        (Some(x), Some(y)) => x.cmp(&y),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.cmp(&b),
                    };
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| (*target_rows[i]).clone()).collect()
            }
            Some("length") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let len_a = target_rows[a].response.as_ref().map(|r| r.response.len());
                    let len_b = target_rows[b].response.as_ref().map(|r| r.response.len());
                    let cmp = match (len_a, len_b) {
                        (Some(x), Some(y)) => x.cmp(&y),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.cmp(&b),
                    };
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| (*target_rows[i]).clone()).collect()
            }
            Some("status") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let st_a = &target_rows[a].status;
                    let st_b = &target_rows[b].status;
                    let cmp = st_a.cmp(st_b);
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| (*target_rows[i]).clone()).collect()
            }
            Some("payload") | Some("payloadPreview") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let p_a = target_rows[a].payload.as_deref().unwrap_or("");
                    let p_b = target_rows[b].payload.as_deref().unwrap_or("");
                    let cmp = p_a.cmp(p_b);
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| (*target_rows[i]).clone()).collect()
            }
            Some("requestDate") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let d_a = &target_rows[a].request_date;
                    let d_b = &target_rows[b].request_date;
                    let cmp = d_a.cmp(d_b);
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| (*target_rows[i]).clone()).collect()
            }
            Some("id") => {
                let mut indices: Vec<usize> = (0..total).collect();
                if is_desc {
                    indices.reverse();
                }
                indices[start..end].iter().map(|&i| (*target_rows[i]).clone()).collect()
            }
            _ => target_rows[start..end].iter().map(|&r| r.clone()).collect(),
        };

        return Ok(FuzzerWindowResult { total, items });
    } else {
        // Fallback to SQLite DB
        if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
            if let Ok(pool) = db_state.pool().await {
                let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(
                    &pool,
                    selected_session as usize,
                    fuzz_history as usize,
                )
                .await;

                let run_info: Option<(i64, String, Option<String>)> = sqlx::query_as(
                    "SELECT total, status, config_snapshot FROM fuzzer_runs WHERE id = ?"
                )
                .bind(&run_id)
                .fetch_optional(&pool)
                .await
                .unwrap_or(None);

                if let Some((total_i64, run_status, config_snapshot_str)) = run_info {
                    let total = total_i64 as usize;
                    let config_snapshot: Option<crate::types::SessionPayload> = config_snapshot_str
                        .and_then(|s| serde_json::from_str(&s).ok());

                    let is_default_sort = (sort_by.is_none() || sort_by.as_deref() == Some("id") || sort_by.as_deref() == Some("sortOrder")) && parsed_httpql.is_none();

                    if show_uncompleted_val && is_default_sort && sort_order.as_deref() != Some("desc") && sort_order.as_deref() != Some("DESC") {
                        let start = offset.min(total);
                        let end = (offset + limit).min(total);
                        let existing_rows = crate::ares_utils::database::fuzzer::fetch_fuzzer_requests_in_range(
                            &pool,
                            &run_id,
                            start as i64,
                            end as i64,
                        )
                        .await
                        .unwrap_or_default();

                        let mut existing_map = HashMap::with_capacity(existing_rows.len());
                        for r in existing_rows {
                            existing_map.insert(r.sort_order as usize, r);
                        }

                        let mut items = Vec::with_capacity(end - start);
                        for idx in start..end {
                            if let Some(r) = existing_map.remove(&idx) {
                                let status = if r.error_message.is_some() || r.connection_dropped {
                                    "error".to_string()
                                } else {
                                    "completed".to_string()
                                };
                                items.push(FuzzerRequestRow {
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
                            } else {
                                let (target_id, payload) = if let Some(ref cfg) = config_snapshot {
                                    crate::fuzzer::utils::generate_payload_for_sort_order(cfg, idx)
                                } else {
                                    (format!("{idx}"), None)
                                };
                                let status = if run_status == "running" {
                                    "pending"
                                } else {
                                    "cancelled"
                                };
                                items.push(FuzzerRequestRow {
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
                                });
                            }
                        }

                        return Ok(FuzzerWindowResult { total, items });
                    } else {
                        let (raw_template_req, target_url) = config_snapshot
                            .as_ref()
                            .map(|cfg| (
                                Some(cfg.raw_request.as_str()),
                                Some(cfg.metadata.target_url.as_str()),
                            ))
                            .unwrap_or((None, None));

                        // Metric sort or HTTPQL query on completed items
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
        Ok(FuzzerWindowResult { total: 0, items: vec![] })
    }
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

/// Stream HTTPQL search results chunk-by-chunk.
///
/// When the HTTPQL expression requires in-memory body/header/regex evaluation
/// (Path B), this command decompresses one chunk at a time, evaluates each
/// response against the expression, and immediately emits matching rows via
/// the Tauri `Channel` — so the frontend can render results progressively
/// without waiting for the full scan to complete.
///
/// For queries that are purely SQL-evaluable (Path A: status code, length,
/// duration, payload), a single `Items` batch + `Done` is emitted from the
/// regular windowed query so the frontend code path is identical.
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

    let config_snapshot: Option<crate::types::SessionPayload> =
        config_snapshot_str.and_then(|s| serde_json::from_str(&s).ok());

    let raw_template_req_owned: Option<String> =
        config_snapshot.as_ref().map(|cfg| cfg.raw_request.clone());
    let target_url_owned: Option<String> = config_snapshot
        .as_ref()
        .map(|cfg| cfg.metadata.target_url.clone());

    let raw_template_req = raw_template_req_owned.as_deref();
    let target_url = target_url_owned.as_deref();

    // Determine whether we need in-memory chunk evaluation.
    let needs_memory_filter =
        crate::ares_utils::httpql::has_response_content_checks(&expr);

    if !needs_memory_filter {
        // Path A: pure SQL filter — emit one batch then Done.
        if let Ok((total, db_rows)) =
            crate::ares_utils::database::fuzzer::query_fuzzer_requests_window(
                &pool,
                &run_id,
                0,
                usize::MAX,
                None,
                None,
                Some(&expr),
                raw_template_req,
                target_url,
            )
            .await
        {
            let items: Vec<FuzzerRequestRow> = db_rows.iter().map(db_row_to_request_row).collect();
            let _ = on_event.send(FuzzerSearchEvent::Items {
                total_so_far: total,
                items,
            });
            let _ = on_event.send(FuzzerSearchEvent::Done { total });
        } else {
            let _ = on_event.send(FuzzerSearchEvent::Done { total: 0 });
        }
        return Ok(());
    }

    // Path B: parallel chunk-by-chunk streaming evaluation.
    //
    // Architecture:
    //   • One tokio task per chunk, concurrency capped by a Semaphore at
    //     floor(available_cpus / 2) so we never saturate the machine.
    //   • Within each task the blob is fetched/decompressed asynchronously
    //     (already cached after first access by fetch_fuzzer_chunk_responses),
    //     then row evaluation is handed to spawn_blocking + rayon::par_iter so
    //     CPU-bound regex/string matching never blocks the async executor.
    //   • Results flow back through JoinSet::join_next() and are accumulated
    //     in a local batch buffer before being sent as Channel events, capping
    //     the IPC message rate at ≤ one event per BATCH_SIZE matches.

    // ── 1. Shared, cheaply-cloneable handles ──────────────────────────────────
    let concurrency = (std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        / 2)
        .max(1);

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));

    // Wrap the expression in Arc so it can be shared across tasks without Clone.
    let expr = std::sync::Arc::new(expr);

    // ── 2. Pre-compute request-side metadata used in every evaluation ─────────
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

    // ── 3. Fetch all candidate rows via the cheap SQL pre-filter ─────────────
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

    // ── 4. Group candidates by chunk_id ───────────────────────────────────────
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

    // ── 5. Evaluate no-chunk rows (error / pending rows) in parallel ──────────
    let mut total_so_far: usize = 0;
    if !no_chunk_rows.is_empty() {
        let expr_nc = expr.clone();
        let tmpl_method_nc = tmpl_method.clone();
        let tmpl_host_nc = tmpl_host.clone();
        let tmpl_path_nc = tmpl_path.clone();
        let raw_req_nc = raw_template_req_owned.clone();

        let no_chunk_matches = tokio::task::spawn_blocking(move || {
            use rayon::prelude::*;
            no_chunk_rows
                .par_iter()
                .filter_map(|row| {
                    let state = if row.error_message.is_some() || row.connection_dropped {
                        "error"
                    } else {
                        "pending"
                    };
                    let item = crate::ares_utils::httpql::FuzzerEvaluableItem {
                        id: row.sort_order as u32,
                        method: &tmpl_method_nc,
                        host: &tmpl_host_nc,
                        path: &tmpl_path_nc,
                        query: None,
                        ext: None,
                        status_code: row.status_code.unwrap_or(0),
                        response_length: row.response_length.unwrap_or(0),
                        response_time_ms: row.response_time_ms.unwrap_or(0),
                        sent_at_ms: row.request_date,
                        state,
                        is_https,
                        raw_request: raw_req_nc.as_deref(),
                        raw_response: None,
                        payload: row.payload.as_deref(),
                    };
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

    // ── 6. Spawn concurrent chunk tasks ──────────────────────────────────────
    let mut join_set =
        tokio::task::JoinSet::<Result<Vec<FuzzerRequestRow>, String>>::new();

    for (chunk_id, rows) in chunk_groups {
        let sem = semaphore.clone();
        let pool = pool.clone();
        let expr = expr.clone();
        let tmpl_method = tmpl_method.clone();
        let tmpl_host = tmpl_host.clone();
        let tmpl_path = tmpl_path.clone();
        let raw_req = raw_template_req_owned.clone();

        join_set.spawn(async move {
            // Acquire semaphore permit — limits concurrency to available_cpus/2.
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;

            // Async I/O: fetch + decompress blob (LRU-cached after first access).
            let resps =
                crate::ares_utils::database::fuzzer::fetch_fuzzer_chunk_responses(
                    &pool, chunk_id,
                )
                .await?;

            // CPU-bound: move row evaluation to the blocking thread pool.
            // rayon::par_iter distributes work across available cores within the task.
            let matches = tokio::task::spawn_blocking(move || {
                use rayon::prelude::*;
                rows.par_iter()
                    .filter_map(|row| {
                        let cidx = row.chunk_index? as usize;
                        let raw_resp = resps.get(cidx)?;
                        let item = crate::ares_utils::httpql::FuzzerEvaluableItem {
                            id: row.sort_order as u32,
                            method: &tmpl_method,
                            host: &tmpl_host,
                            path: &tmpl_path,
                            query: None,
                            ext: None,
                            status_code: row.status_code.unwrap_or(0),
                            response_length: row.response_length.unwrap_or(0),
                            response_time_ms: row.response_time_ms.unwrap_or(0),
                            sent_at_ms: row.request_date,
                            state: "completed",
                            is_https,
                            raw_request: raw_req.as_deref(),
                            raw_response: Some(raw_resp.as_str()),
                            payload: row.payload.as_deref(),
                        };
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

    // ── 7. Collect results as tasks finish; batch before sending ─────────────
    // Batching caps the IPC event rate: we only emit to the frontend once we
    // have BATCH_SIZE matches accumulated, or when all tasks are done.
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
                    // Frontend dropped the channel — cancel all in-flight tasks.
                    join_set.abort_all();
                    return Ok(());
                }
            }
        }
    }

    // Flush any remaining matches that didn't fill a full batch.
    if !batch.is_empty() {
        total_so_far += batch.len();
        let _ = on_event.send(FuzzerSearchEvent::Items {
            items: batch,
            total_so_far,
        });
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

const TIME_TO_UPDATE: Duration = Duration::from_millis(300);

fn cancellations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    FUZZ_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn run_key(session: u32, history: u32) -> String {
    format!("{session}:{history}")
}

pub async fn register_run(session: u32, history: u32) -> Arc<AtomicBool> {
    let key = run_key(session, history);
    let flag = Arc::new(AtomicBool::new(false));
    cancellations().lock().await.insert(key, Arc::clone(&flag));
    flag
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
    let num_workers = config.num_tasks.max(1);

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
    let agg_conn_dropped = Arc::clone(&any_worker_dropped);

    let aggregator_handle = tokio::spawn(async move {
        let mut ticker = interval(TIME_TO_UPDATE);
        loop {
            ticker.tick().await;
            let done = agg_completed.load(Ordering::Relaxed);
            let fail_count = agg_failed.load(Ordering::Relaxed);
            let is_cancelled = agg_cancel.load(Ordering::Relaxed);
            let dropped = agg_conn_dropped.load(Ordering::Relaxed);

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
                dropped,
            );

            if is_cancelled || done >= total {
                break;
            }
        }
    });

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
        const TIMEOUT_FLUSH_DURATION: Duration = Duration::from_millis(2000);

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

    // Spawn dynamic consumer workers
    let mut handles = Vec::with_capacity(num_workers);

    for worker_idx in 0..num_workers {
        let queue_clone = Arc::clone(&queue);
        let completed_clone = Arc::clone(&completed);
        let failed_clone = Arc::clone(&failed);
        let cancel_clone = Arc::clone(&cancel);
        let dropped_clone = Arc::clone(&any_worker_dropped);
        let url = config.url.clone();
        let delay_ms = config.delay_ms;
        let chunk_tx_w = chunk_tx.clone();

        let handle = tokio::spawn(async move {
            // Jitter / staggering on startup to avoid thundering-herd SYN burst
            let startup_jitter_ms = ((worker_idx as u64) * 8).min(200) + (worker_idx as u64 % 7);
            if startup_jitter_ms > 0 {
                sleep(Duration::from_millis(startup_jitter_ms)).await;
            }

            let mut conn: Option<HttpConnection> = None;
            let mut consecutive_conn_failures = 0usize;

            loop {
                if cancel_clone.load(Ordering::Relaxed) {
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
                            tracing::warn!("Worker {} connect failed (attempt {}): {}", worker_idx, consecutive_conn_failures, e);
                            dropped_clone.store(true, Ordering::Relaxed);

                            // Push target back to front of the queue so another worker or retry can process it
                            {
                                let mut q = match queue_clone.lock() {
                                    Ok(g) => g,
                                    Err(p) => p.into_inner(),
                                };
                                q.push_front(target);
                            }

                            if consecutive_conn_failures >= 5 {
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
                                        if delay_ms > 0 {
                                            sleep(Duration::from_millis(delay_ms)).await;
                                        }
                                        continue;
                                    }
                                    Err(retry_err) => {
                                        tracing::warn!("Worker {} request retry failed: {}", worker_idx, retry_err);
                                    }
                                }
                            }

                            // Connection dropped: invalidate socket and push target back to front of queue
                            conn = None;
                            dropped_clone.store(true, Ordering::Relaxed);
                            consecutive_conn_failures += 1;

                            {
                                let mut q = match queue_clone.lock() {
                                    Ok(g) => g,
                                    Err(p) => p.into_inner(),
                                };
                                q.push_front(target);
                            }

                            if consecutive_conn_failures >= 5 {
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
        });

        handles.push(handle);
    }

    for handle in handles {
        let _ = handle.await;
    }

    drop(chunk_tx);
    let _ = flusher_handle.await;
    aggregator_handle.abort();

    let final_completed = completed.load(Ordering::Relaxed);
    let final_failed = failed.load(Ordering::Relaxed);
    let conn_dropped = any_worker_dropped.load(Ordering::Relaxed);
    let cancelled = cancel.load(Ordering::Relaxed);

    if cancelled {
        update_store_cancelled(selected_session, fuzz_history).await;
    }

    let status = if cancelled && final_completed < total {
        "cancelled"
    } else if conn_dropped && final_completed < total {
        "connection_dropped"
    } else if final_completed < total {
        "cancelled"
    } else {
        "completed"
    };

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
                    "INSERT INTO fuzzer_sessions (id, project_id, name, target_url, raw_request, sort_order, is_selected, is_expanded, created_at)
                     VALUES (?, ?, ?, ?, '', ?, 1, 1, ?)"
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
pub async fn resend_fuzz_request(
    app: AppHandle,
    url: String,
    target: FuzzTarget,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<(), String> {
    let id = target.id.clone();
    update_store_pending(selected_session, fuzz_history, &[id]).await;

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    let (completed, total) = {
        let key = run_key(selected_session, fuzz_history);
        let store = fuzz_store().lock().await;
        if let Some(run_data) = store.get(&key) {
            let comp = run_data.rows.iter().filter(|r| r.status == "completed").count() as u32;
            (comp, run_data.rows.len() as u32)
        } else {
            (0, 1)
        }
    };

    let config = FuzzRunConfig {
        url,
        delay_ms: 0,
        num_tasks: 1,
        selected_session,
        fuzz_history,
        register_cancel: false,
        config_snapshot: None,
    };

    tokio::spawn(async move {
        run_dynamic_fuzzer(app, config, vec![target], completed, total, db_pool).await;
    });

    Ok(())
}

async fn get_remaining_or_failed_targets(app: &AppHandle, session: u32, history: u32) -> (Vec<FuzzTarget>, u32, u32, u32) {
    let key = run_key(session, history);
    let store = fuzz_store().lock().await;
    let mut targets = Vec::new();
    let mut completed_count = 0;
    let mut failed_count = 0;
    let mut total_count = 0;

    if let Some(run_data) = store.get(&key) {
        total_count = run_data.rows.len() as u32;
        let config = run_data.config_snapshot.clone();
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

            if let Some((total_i64, config_snapshot_str)) = run_info {
                total_count = total_i64 as u32;
                let config_snapshot: Option<crate::types::SessionPayload> = config_snapshot_str
                    .and_then(|s| serde_json::from_str(&s).ok());

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

    (targets, completed_count, failed_count, total_count)
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
    let (targets, completed_count, _failed_count, total_count) =
        get_remaining_or_failed_targets(&app, selected_session, fuzz_history).await;

    if targets.is_empty() {
        return Err("No targets to resend".to_string());
    }
    let ids: Vec<String> = targets.iter().map(|t| t.id.clone()).collect();
    update_store_pending(selected_session, fuzz_history, &ids).await;

    let total = if overall_total > 0 { overall_total } else { total_count };
    let completed = if already_completed > 0 { already_completed } else { completed_count };

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    let config = FuzzRunConfig {
        url,
        delay_ms,
        num_tasks: 4,
        selected_session,
        fuzz_history,
        register_cancel: true,
        config_snapshot: None,
    };

    tokio::spawn(async move {
        run_dynamic_fuzzer(app, config, targets, completed, total, db_pool).await;
    });

    Ok(())
}

