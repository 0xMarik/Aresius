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
    pub request: String,
    #[serde(default)]
    pub payload: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerRequestRow {
    pub id: usize,
    pub fuzz_request_id: String,
    pub raw_request: String,
    pub payload: Option<String>,
    pub response: Option<ReqRes>,
    pub request_date: String,
    pub status: String,
    pub error_message: Option<String>,
    pub connection_dropped: bool,
    pub worker_id: Option<u32>,
}

#[derive(Debug)]
pub struct FuzzerRunData {
    pub rows: Vec<FuzzerRequestRow>,
    pub id_map: HashMap<String, usize>,
}

static FUZZ_STORE: OnceLock<Mutex<HashMap<String, FuzzerRunData>>> = OnceLock::new();

fn fuzz_store() -> &'static Mutex<HashMap<String, FuzzerRunData>> {
    FUZZ_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn init_fuzz_store(session: u32, history: u32, targets: &[FuzzTarget]) {
    let key = run_key(session, history);
    let mut id_map = HashMap::with_capacity(targets.len());
    let mut rows = Vec::with_capacity(targets.len());
    let now = chrono::Utc::now().to_rfc3339();

    for (idx, target) in targets.iter().enumerate() {
        id_map.insert(target.id.clone(), idx);
        rows.push(FuzzerRequestRow {
            id: idx,
            fuzz_request_id: target.id.clone(),
            raw_request: target.request.clone(),
            payload: target.payload.clone(),
            response: None,
            request_date: now.clone(),
            status: "pending".to_string(),
            error_message: None,
            connection_dropped: false,
            worker_id: None,
        });
    }

    fuzz_store().lock().await.insert(key, FuzzerRunData { rows, id_map });
}

pub async fn update_store_completed(
    session: u32,
    history: u32,
    id: &str,
    req_res: ReqRes,
    worker_id: Option<u32>,
) {
    let key = run_key(session, history);
    let mut store = fuzz_store().lock().await;
    if let Some(run_data) = store.get_mut(&key) {
        if let Some(&idx) = run_data.id_map.get(id) {
            if let Some(row) = run_data.rows.get_mut(idx) {
                row.status = "completed".to_string();
                row.raw_request = req_res.request.clone();
                row.response = Some(req_res);
                row.error_message = None;
                row.connection_dropped = false;
                row.worker_id = worker_id;
            }
        }
    }
}

pub async fn update_store_error(
    session: u32,
    history: u32,
    id: &str,
    message: String,
    connection_dropped: bool,
    request: String,
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
                if !request.is_empty() {
                    row.raw_request = request;
                }
                row.worker_id = worker_id;
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
) -> Result<FuzzerWindowResult, String> {
    let key = run_key(selected_session, fuzz_history);
    let store = fuzz_store().lock().await;
    if let Some(run_data) = store.get(&key) {
        let total = run_data.rows.len();
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
                    let code_a = run_data.rows[a]
                        .response
                        .as_ref()
                        .and_then(|r| crate::ares_utils::database::fuzzer::parse_status_code(&r.response));
                    let code_b = run_data.rows[b]
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
                indices[start..end].iter().map(|&i| run_data.rows[i].clone()).collect()
            }
            Some("duration") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let dur_a = run_data.rows[a].response.as_ref().map(|r| r.response_time);
                    let dur_b = run_data.rows[b].response.as_ref().map(|r| r.response_time);
                    let cmp = match (dur_a, dur_b) {
                        (Some(x), Some(y)) => x.cmp(&y),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.cmp(&b),
                    };
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| run_data.rows[i].clone()).collect()
            }
            Some("length") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let len_a = run_data.rows[a].response.as_ref().map(|r| r.response.len());
                    let len_b = run_data.rows[b].response.as_ref().map(|r| r.response.len());
                    let cmp = match (len_a, len_b) {
                        (Some(x), Some(y)) => x.cmp(&y),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.cmp(&b),
                    };
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| run_data.rows[i].clone()).collect()
            }
            Some("status") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let st_a = &run_data.rows[a].status;
                    let st_b = &run_data.rows[b].status;
                    let cmp = st_a.cmp(st_b);
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| run_data.rows[i].clone()).collect()
            }
            Some("payload") | Some("payloadPreview") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let p_a = run_data.rows[a].payload.as_deref().unwrap_or("");
                    let p_b = run_data.rows[b].payload.as_deref().unwrap_or("");
                    let cmp = p_a.cmp(p_b);
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| run_data.rows[i].clone()).collect()
            }
            Some("requestDate") => {
                let mut indices: Vec<usize> = (0..total).collect();
                indices.sort_by(|&a, &b| {
                    let d_a = &run_data.rows[a].request_date;
                    let d_b = &run_data.rows[b].request_date;
                    let cmp = d_a.cmp(d_b);
                    if is_desc { cmp.reverse() } else { cmp }
                });
                indices[start..end].iter().map(|&i| run_data.rows[i].clone()).collect()
            }
            Some("id") => {
                let mut indices: Vec<usize> = (0..total).collect();
                if is_desc {
                    indices.reverse();
                }
                indices[start..end].iter().map(|&i| run_data.rows[i].clone()).collect()
            }
            _ => run_data.rows[start..end].to_vec(),
        };

        Ok(FuzzerWindowResult { total, items })
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
                if let Ok((total, db_rows)) = crate::ares_utils::database::fuzzer::query_fuzzer_requests_window(
                    &pool,
                    &run_id,
                    offset,
                    limit,
                    sort_by.as_deref(),
                    sort_order.as_deref(),
                ).await {
                    let items: Vec<FuzzerRequestRow> = db_rows.into_iter().map(|r| {
                        let response = if let Some(raw_resp) = r.raw_response {
                            Some(crate::types::ReqRes {
                                request: r.raw_request.clone(),
                                response: raw_resp,
                                response_time: r.response_time_ms.unwrap_or(0) as u128,
                            })
                        } else {
                            None
                        };
                        FuzzerRequestRow {
                            id: r.sort_order as usize,
                            fuzz_request_id: r.id,
                            raw_request: r.raw_request,
                            payload: r.payload,
                            response,
                            request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
                                .map(|dt| dt.to_rfc3339())
                                .unwrap_or_default(),
                            status: r.status,
                            error_message: r.error_message,
                            connection_dropped: r.connection_dropped,
                            worker_id: r.worker_id.map(|w| w as u32),
                        }
                    }).collect();
                    return Ok(FuzzerWindowResult { total, items });
                }
            }
        }
        Ok(FuzzerWindowResult { total: 0, items: vec![] })
    }
}

#[tauri::command]
pub async fn get_fuzzer_request_by_id(
    app: tauri::AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    request_id: String,
) -> Result<Option<FuzzerRequestRow>, String> {
    let key = run_key(selected_session, fuzz_history);
    let store = fuzz_store().lock().await;
    if let Some(run_data) = store.get(&key) {
        if let Some(&idx) = run_data.id_map.get(&request_id) {
            return Ok(run_data.rows.get(idx).cloned());
        } else if let Ok(idx) = request_id.parse::<usize>() {
            return Ok(run_data.rows.get(idx).cloned());
        }
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
                let response = if let Some(raw_resp) = r.raw_response {
                    Some(crate::types::ReqRes {
                        request: r.raw_request.clone(),
                        response: raw_resp,
                        response_time: r.response_time_ms.unwrap_or(0) as u128,
                    })
                } else {
                    None
                };
                return Ok(Some(FuzzerRequestRow {
                    id: r.sort_order as usize,
                    fuzz_request_id: r.id,
                    raw_request: r.raw_request,
                    payload: r.payload,
                    response,
                    request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default(),
                    status: r.status,
                    error_message: r.error_message,
                    connection_dropped: r.connection_dropped,
                    worker_id: r.worker_id.map(|w| w as u32),
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
        let db_pool_w = db_pool.clone();
        let run_id_w = run_id.clone();

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

                match c.send_request(target.request.as_bytes()).await {
                    Ok(response) => {
                        consecutive_conn_failures = 0;
                        let req_res = ReqRes {
                            request: target.request.clone(),
                            response: response.as_text_lossy(),
                            response_time: response.elapsed.as_millis(),
                        };
                        update_store_completed(selected_session, fuzz_history, &target.id, req_res.clone(), Some(worker_idx as u32)).await;

                        if let Some(ref p) = db_pool_w {
                            let p_c = p.clone();
                            let run_id_c = run_id_w.clone();
                            let req_res_c = req_res.clone();
                            let id_c = target.id.clone();
                            tokio::spawn(async move {
                                let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_completed(&p_c, &run_id_c, &id_c, &req_res_c).await;
                            });
                        }
                        completed_clone.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        let is_conn_err = is_connection_error(&msg);

                        if is_conn_err {
                            // Attempt reconnect & retry
                            if c.reconnect().await.is_ok() {
                                match c.send_request(target.request.as_bytes()).await {
                                    Ok(response) => {
                                        consecutive_conn_failures = 0;
                                        let req_res = ReqRes {
                                            request: target.request.clone(),
                                            response: response.as_text_lossy(),
                                            response_time: response.elapsed.as_millis(),
                                        };
                                        update_store_completed(selected_session, fuzz_history, &target.id, req_res.clone(), Some(worker_idx as u32)).await;

                                        if let Some(ref p) = db_pool_w {
                                            let p_c = p.clone();
                                            let run_id_c = run_id_w.clone();
                                            let req_res_c = req_res.clone();
                                            let id_c = target.id.clone();
                                            tokio::spawn(async move {
                                                let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_completed(&p_c, &run_id_c, &id_c, &req_res_c).await;
                                            });
                                        }
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
                            update_store_error(selected_session, fuzz_history, &target.id, msg.clone(), false, target.request.clone(), Some(worker_idx as u32)).await;

                            if let Some(ref p) = db_pool_w {
                                let p_c = p.clone();
                                let run_id_c = run_id_w.clone();
                                let id_c = target.id.clone();
                                let msg_c = msg.clone();
                                tokio::spawn(async move {
                                    let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_error(&p_c, &run_id_c, &id_c, &msg_c, false, None).await;
                                });
                            }
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

        if cancelled {
            let _ = crate::ares_utils::database::fuzzer::cancel_pending_fuzzer_requests(pool, &run_id).await;
        }
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

    init_fuzz_store(selected_session, fuzz_history, &targets).await;

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

        let target_tuples: Vec<(String, String, Option<u32>, Option<String>)> = targets
            .iter()
            .map(|t| {
                (t.id.clone(), t.request.clone(), None, t.payload.clone())
            })
            .collect();
        let _ = crate::ares_utils::database::fuzzer::batch_insert_fuzzer_requests(pool, &run_id, &target_tuples).await;
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
                let _ = crate::ares_utils::database::fuzzer::cancel_pending_fuzzer_requests(&pool, &run_id).await;
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
    let mut store = fuzz_store().lock().await;
    let mut targets = Vec::new();
    let mut completed_count = 0;
    let mut failed_count = 0;
    let mut total_count = 0;

    if let Some(run_data) = store.get(&key) {
        total_count = run_data.rows.len() as u32;
        for row in run_data.rows.iter() {
            if row.status == "completed" {
                completed_count += 1;
            } else if row.status == "error" || row.connection_dropped || row.status == "cancelled" || row.status == "pending" {
                if row.status == "error" {
                    failed_count += 1;
                }
                targets.push(FuzzTarget {
                    id: row.fuzz_request_id.clone(),
                    request: row.raw_request.clone(),
                    payload: row.payload.clone(),
                });
            }
        }
    } else if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        if let Ok(pool) = db_state.pool().await {
            let run_id = crate::ares_utils::database::fuzzer::resolve_fuzzer_run_id(&pool, session as usize, history as usize).await;
            if let Ok(rows) = crate::ares_utils::database::fuzzer::load_all_fuzzer_requests(&pool, &run_id).await {
                total_count = rows.len() as u32;
                let mut id_map = HashMap::with_capacity(rows.len());
                let mut store_rows = Vec::with_capacity(rows.len());
                for r in &rows {
                    if r.status == "completed" {
                        completed_count += 1;
                    } else {
                        if r.status == "error" {
                            failed_count += 1;
                        }
                        targets.push(FuzzTarget {
                            id: r.id.clone(),
                            request: r.raw_request.clone(),
                            payload: r.payload.clone(),
                        });
                    }

                    let response = if let Some(raw_resp) = &r.raw_response {
                        Some(crate::types::ReqRes {
                            request: r.raw_request.clone(),
                            response: raw_resp.clone(),
                            response_time: r.response_time_ms.unwrap_or(0) as u128,
                        })
                    } else {
                        None
                    };

                    let idx = store_rows.len();
                    id_map.insert(r.id.clone(), idx);
                    store_rows.push(FuzzerRequestRow {
                        id: r.sort_order as usize,
                        fuzz_request_id: r.id.clone(),
                        raw_request: r.raw_request.clone(),
                        payload: r.payload.clone(),
                        response,
                        request_date: chrono::DateTime::from_timestamp_millis(r.request_date)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default(),
                        status: r.status.clone(),
                        error_message: r.error_message.clone(),
                        connection_dropped: r.connection_dropped,
                        worker_id: r.worker_id.map(|w| w as u32),
                    });
                }
                if !store_rows.is_empty() {
                    store.insert(key, FuzzerRunData { rows: store_rows, id_map });
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

