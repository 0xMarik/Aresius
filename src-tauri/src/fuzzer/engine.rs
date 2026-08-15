use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{interval, sleep, Duration};

use crate::ares_utils::http_connection::HttpConnection;
use crate::types::ReqRes;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct FuzzTarget {
    pub id: String,
    pub request: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerRequestRow {
    pub fuzz_request_id: String,
    pub raw_request: String,
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

pub async fn init_fuzz_store(session: u32, history: u32, targets: &[FuzzTarget], num_tasks: usize) {
    let key = run_key(session, history);
    let mut id_map = HashMap::with_capacity(targets.len());
    let mut rows = Vec::with_capacity(targets.len());
    let now = chrono::Utc::now().to_rfc3339();
    let num_tasks = num_tasks.max(1);
    let chunk_size = if !targets.is_empty() {
        (targets.len() + num_tasks - 1) / num_tasks
    } else {
        1
    };

    for (idx, target) in targets.iter().enumerate() {
        let worker_id = (idx / chunk_size) as u32;
        id_map.insert(target.id.clone(), idx);
        rows.push(FuzzerRequestRow {
            fuzz_request_id: target.id.clone(),
            raw_request: target.request.clone(),
            response: None,
            request_date: now.clone(),
            status: "pending".to_string(),
            error_message: None,
            connection_dropped: false,
            worker_id: Some(worker_id),
        });
    }

    fuzz_store().lock().await.insert(key, FuzzerRunData { rows, id_map });
}

pub async fn update_store_completed(session: u32, history: u32, id: &str, req_res: ReqRes) {
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
                let run_id = format!("{}-{}", selected_session, fuzz_history);
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
                            fuzz_request_id: r.id,
                            raw_request: r.raw_request,
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
            let row = sqlx::query_as::<_, crate::ares_utils::database::fuzzer::FuzzerRequestDb>(
                "SELECT * FROM fuzzer_requests WHERE id = ?"
            )
            .bind(&request_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);

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
                    fuzz_request_id: r.id,
                    raw_request: r.raw_request,
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
struct FuzzUpdateCompleted {
    id: String,
    selected_session: u32,
    fuzz_history: u32,
    req_res: ReqRes,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FuzzUpdateError {
    id: String,
    selected_session: u32,
    fuzz_history: u32,
    message: String,
    connection_dropped: bool,
    request: String,
}

#[derive(Clone, Serialize)]
enum FuzzUpdate {
    Completed(FuzzUpdateCompleted),
    Error(FuzzUpdateError),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzProgress {
    pub selected_session: u32,
    pub fuzz_history: u32,
    pub completed: u32,
    pub total: u32,
    pub status: String,
    pub connection_dropped: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzWorkerUpdate {
    pub selected_session: u32,
    pub fuzz_history: u32,
    pub worker_id: u32,
    pub status: String,
    pub completed: u32,
    pub total: u32,
    pub message: Option<String>,
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

const TIME_TO_UPDATE: Duration = Duration::from_millis(500);

#[derive(Clone)]
pub struct WorkerHandleInfo {
    pub worker_id: u32,
    pub completed: Arc<AtomicU32>,
    pub total: u32,
    pub dropped: Arc<AtomicBool>,
}

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

fn emit_worker_update(
    app: &AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    worker_id: u32,
    status: &str,
    completed: u32,
    total: u32,
    message: Option<String>,
) {
    let _ = app.emit(
        "fuzz-worker-update",
        FuzzWorkerUpdate {
            selected_session,
            fuzz_history,
            worker_id,
            status: status.to_string(),
            completed,
            total,
            message,
        },
    );
}

fn emit_progress(
    app: &AppHandle,
    selected_session: u32,
    fuzz_history: u32,
    completed: u32,
    total: u32,
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
            status: status.to_string(),
            connection_dropped,
        },
    );
}

async fn send_error(
    tx: &mpsc::UnboundedSender<FuzzUpdate>,
    id: &str,
    request: &str,
    message: String,
    selected_session: u32,
    fuzz_history: u32,
    connection_dropped: bool,
) {
    update_store_error(selected_session, fuzz_history, id, message.clone(), connection_dropped, request.to_string()).await;
    let _ = tx.send(FuzzUpdate::Error(FuzzUpdateError {
        id: id.to_string(),
        message,
        selected_session,
        fuzz_history,
        connection_dropped,
        request: request.to_string(),
    }));
}

async fn process_chunk(
    app: AppHandle,
    worker_id: u32,
    chunk: Vec<FuzzTarget>,
    url: String,
    delay: u64,
    selected_session: u32,
    fuzz_history: u32,
    tx: mpsc::UnboundedSender<FuzzUpdate>,
    cancel: Arc<AtomicBool>,
    completed: Arc<AtomicU32>,
    worker_dropped: Arc<AtomicBool>,
    worker_completed_counter: Arc<AtomicU32>,
    worker_completed_offset: u32,
    worker_total_override: Option<u32>,
    db_pool: Option<sqlx::SqlitePool>,
) {
    let worker_total = worker_total_override.unwrap_or(chunk.len() as u32);
    worker_completed_counter.store(worker_completed_offset, Ordering::Relaxed);
    emit_worker_update(
        &app,
        selected_session,
        fuzz_history,
        worker_id,
        "connected",
        worker_completed_offset,
        worker_total,
        None,
    );

    let run_id = format!("{}-{}", selected_session, fuzz_history);

    let mut conn = match HttpConnection::new(&url).await {
        Ok(conn) => conn,
        Err(e) => {
            let msg = format!("Connection failed: {e}");
            tracing::error!("Worker {worker_id}: {}", msg);
            worker_dropped.store(true, Ordering::Relaxed);
            emit_worker_update(
                &app,
                selected_session,
                fuzz_history,
                worker_id,
                "dropped",
                worker_completed_offset,
                worker_total,
                Some(msg.clone()),
            );
            for target in &chunk {
                send_error(
                    &tx,
                    &target.id,
                    &target.request,
                    msg.clone(),
                    selected_session,
                    fuzz_history,
                    true,
                )
                .await;
                if let Some(ref p) = db_pool {
                    let p_c = p.clone();
                    let run_id_c = run_id.clone();
                    let id_c = target.id.clone();
                    let msg_c = msg.clone();
                    tokio::spawn(async move {
                        let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_error(&p_c, &run_id_c, &id_c, &msg_c, true, None).await;
                    });
                }
            }
            return;
        }
    };

    emit_worker_update(
        &app,
        selected_session,
        fuzz_history,
        worker_id,
        "running",
        worker_completed_offset,
        worker_total,
        None,
    );

    let mut dropped = false;
    let mut worker_completed = worker_completed_offset;

    for (idx, target) in chunk.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        if dropped {
            send_error(
                &tx,
                &target.id,
                &target.request,
                "Connection dropped — request not sent".to_string(),
                selected_session,
                fuzz_history,
                true,
            )
            .await;
            if let Some(ref p) = db_pool {
                let p_c = p.clone();
                let run_id_c = run_id.clone();
                let id_c = target.id.clone();
                tokio::spawn(async move {
                    let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_error(&p_c, &run_id_c, &id_c, "Connection dropped — request not sent", true, None).await;
                });
            }
            worker_completed += 1;
            worker_completed_counter.store(worker_completed, Ordering::Relaxed);
            continue;
        }

        match conn.send_request(&target.request.as_bytes()).await {
            Ok(response) => {
                let req_res = ReqRes {
                    request: target.request.clone(),
                    response: response.as_text_lossy(),
                    response_time: response.elapsed.as_millis(),
                };
                update_store_completed(selected_session, fuzz_history, &target.id, req_res.clone()).await;
                if let Some(ref p) = db_pool {
                    let p_c = p.clone();
                    let run_id_c = run_id.clone();
                    let req_res_c = req_res.clone();
                    let id_c = target.id.clone();
                    tokio::spawn(async move {
                        let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_completed(&p_c, &run_id_c, &id_c, &req_res_c).await;
                    });
                }
                let _ = tx.send(FuzzUpdate::Completed(FuzzUpdateCompleted {
                    id: target.id.clone(),
                    req_res,
                    selected_session,
                    fuzz_history,
                }));
            }
            Err(e) => {
                let msg = e.to_string();
                let is_conn_err = is_connection_error(&msg);

                if is_conn_err && conn.reconnect().await.is_ok() {
                    match conn.send_request(&target.request.as_bytes()).await {
                        Ok(response) => {
                            let req_res = ReqRes {
                                request: target.request.clone(),
                                response: response.as_text_lossy(),
                                response_time: response.elapsed.as_millis(),
                            };
                            update_store_completed(selected_session, fuzz_history, &target.id, req_res.clone()).await;
                            if let Some(ref p) = db_pool {
                                let p_c = p.clone();
                                let run_id_c = run_id.clone();
                                let req_res_c = req_res.clone();
                                let id_c = target.id.clone();
                                tokio::spawn(async move {
                                    let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_completed(&p_c, &run_id_c, &id_c, &req_res_c).await;
                                });
                            }
                            let _ = tx.send(FuzzUpdate::Completed(FuzzUpdateCompleted {
                                id: target.id.clone(),
                                req_res,
                                selected_session,
                                fuzz_history,
                            }));
                            completed.fetch_add(1, Ordering::Relaxed);
                            worker_completed += 1;
                            worker_completed_counter.store(worker_completed, Ordering::Relaxed);
                            if delay > 0 {
                                sleep(Duration::from_millis(delay)).await;
                            }
                            continue;
                        }
                        Err(retry_err) => {
                            let retry_msg = retry_err.to_string();
                            send_error(
                                &tx,
                                &target.id,
                                &target.request,
                                retry_msg.clone(),
                                selected_session,
                                fuzz_history,
                                true,
                            )
                            .await;
                            if let Some(ref p) = db_pool {
                                let p_c = p.clone();
                                let run_id_c = run_id.clone();
                                let id_c = target.id.clone();
                                let rmsg_c = retry_msg.clone();
                                tokio::spawn(async move {
                                    let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_error(&p_c, &run_id_c, &id_c, &rmsg_c, true, None).await;
                                });
                            }
                            worker_dropped.store(true, Ordering::Relaxed);
                            dropped = true;
                            completed.fetch_add(1, Ordering::Relaxed);
                            worker_completed += 1;
                            worker_completed_counter.store(worker_completed, Ordering::Relaxed);
                            emit_worker_update(
                                &app,
                                selected_session,
                                fuzz_history,
                                worker_id,
                                "dropped",
                                worker_completed,
                                worker_total,
                                Some(retry_msg),
                            );
                            continue;
                        }
                    }
                }

                send_error(
                    &tx,
                    &target.id,
                    &target.request,
                    msg.clone(),
                    selected_session,
                    fuzz_history,
                    is_conn_err,
                )
                .await;
                if let Some(ref p) = db_pool {
                    let p_c = p.clone();
                    let run_id_c = run_id.clone();
                    let id_c = target.id.clone();
                    let msg_c = msg.clone();
                    tokio::spawn(async move {
                        let _ = crate::ares_utils::database::fuzzer::update_fuzzer_request_error(&p_c, &run_id_c, &id_c, &msg_c, is_conn_err, None).await;
                    });
                }

                if is_conn_err {
                    worker_dropped.store(true, Ordering::Relaxed);
                    dropped = true;
                    worker_completed += 1;
                    worker_completed_counter.store(worker_completed, Ordering::Relaxed);
                    emit_worker_update(
                        &app,
                        selected_session,
                        fuzz_history,
                        worker_id,
                        "dropped",
                        worker_completed,
                        worker_total,
                        Some(msg),
                    );
                }
            }
        }

        completed.fetch_add(1, Ordering::Relaxed);
        worker_completed += 1;
        worker_completed_counter.store(worker_completed, Ordering::Relaxed);

        if delay > 0 && idx + 1 < chunk.len() {
            sleep(Duration::from_millis(delay)).await;
        }
    }
}

pub async fn run_fuzz_targets(app: AppHandle, config: FuzzRunConfig, targets: Vec<FuzzTarget>) {
    let total = targets.len() as u32;
    let selected_session = config.selected_session;
    let fuzz_history = config.fuzz_history;

    let num_tasks = config.num_tasks.max(1);
    init_fuzz_store(selected_session, fuzz_history, &targets, num_tasks).await;

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    let run_id = format!("{}-{}", selected_session, fuzz_history);
    let chunk_size = (targets.len() + num_tasks - 1) / num_tasks;

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
                "INSERT INTO fuzzer_runs (id, session_id, config_snapshot, status, total, completed, completed_base, connection_dropped, started_at)
                 VALUES (?, ?, ?, 'running', ?, 0, 0, 0, ?)
                 ON CONFLICT(id) DO UPDATE SET status = 'running', total = excluded.total, config_snapshot = excluded.config_snapshot, started_at = excluded.started_at"
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
                "INSERT INTO fuzzer_runs (id, session_id, config_snapshot, status, total, completed, completed_base, connection_dropped, started_at)
                 VALUES (?, ?, ?, 'running', ?, 0, 0, 0, ?)
                 ON CONFLICT(id) DO UPDATE SET status = 'running', total = excluded.total, started_at = excluded.started_at"
            )
            .bind(&run_id)
            .bind(&session_id)
            .bind(&default_snapshot)
            .bind(total as i64)
            .bind(now)
            .execute(pool)
            .await;
        }

        for (w_id, chunk) in targets.chunks(chunk_size.max(1)).enumerate() {
            let _ = sqlx::query(
                "INSERT INTO fuzzer_workers (run_id, worker_id, status, total, completed)
                 VALUES (?, ?, 'pending', ?, 0)"
            )
            .bind(&run_id)
            .bind(w_id as i64)
            .bind(chunk.len() as i64)
            .execute(pool)
            .await;
        }

        let target_tuples: Vec<(String, String, Option<u32>)> = targets
            .iter()
            .enumerate()
            .map(|(idx, t)| {
                let w_id = (idx / chunk_size.max(1)) as u32;
                (t.id.clone(), t.request.clone(), Some(w_id))
            })
            .collect();
        let _ = crate::ares_utils::database::fuzzer::batch_insert_fuzzer_requests(pool, &run_id, &target_tuples).await;
    }

    if targets.is_empty() {
        emit_progress(
            &app,
            selected_session,
            fuzz_history,
            0,
            0,
            "completed",
            false,
        );
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

    let completed = Arc::new(AtomicU32::new(0));
    let any_worker_dropped = Arc::new(AtomicBool::new(false));

    emit_progress(
        &app,
        selected_session,
        fuzz_history,
        0,
        total,
        "running",
        false,
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<FuzzUpdate>();

    let mut worker_infos = Vec::new();
    for (worker_id, chunk) in targets.chunks(chunk_size.max(1)).enumerate() {
        let worker_total = chunk.len() as u32;
        worker_infos.push(WorkerHandleInfo {
            worker_id: worker_id as u32,
            completed: Arc::new(AtomicU32::new(0)),
            total: worker_total,
            dropped: Arc::new(AtomicBool::new(false)),
        });
    }

    let agg_app = app.clone();
    let agg_completed = Arc::clone(&completed);
    let agg_conn_dropped = Arc::clone(&any_worker_dropped);
    let agg_cancel = Arc::clone(&cancel);
    let agg_workers = worker_infos.clone();

    let aggregator = tokio::spawn(async move {
        let mut ticker = interval(TIME_TO_UPDATE);
        let mut buffer = Vec::new();
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if !buffer.is_empty() {
                        let _ = agg_app.emit("fuzz-update-batch", &buffer);
                        buffer.clear();
                    }
                    let done = agg_completed.load(Ordering::Relaxed);
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
                        status,
                        agg_conn_dropped.load(Ordering::Relaxed),
                    );
                    for w in &agg_workers {
                        let w_done = w.completed.load(Ordering::Relaxed);
                        let w_dropped = w.dropped.load(Ordering::Relaxed);
                        let w_status = if w_dropped {
                            "dropped"
                        } else if w_done >= w.total || is_cancelled {
                            "completed"
                        } else {
                            "running"
                        };
                        emit_worker_update(
                            &agg_app,
                            selected_session,
                            fuzz_history,
                            w.worker_id,
                            w_status,
                            w_done,
                            w.total,
                            None,
                        );
                    }
                }
                maybe_update = rx.recv() => {
                    match maybe_update {
                        Some(update) => buffer.push(update),
                        None => {
                            if !buffer.is_empty() {
                                let _ = agg_app.emit("fuzz-update-batch", &buffer);
                            }
                            break;
                        }
                    }
                }
            }
        }
    });

    let mut handles = vec![];

    for (worker_id, chunk) in targets.chunks(chunk_size.max(1)).enumerate() {
        let chunk = chunk.to_vec();
        let url = config.url.clone();
        let delay = config.delay_ms;
        let tx = tx.clone();
        let cancel = Arc::clone(&cancel);
        let completed = Arc::clone(&completed);
        let worker_info = &worker_infos[worker_id];
        let worker_dropped = Arc::clone(&worker_info.dropped);
        let worker_completed_counter = Arc::clone(&worker_info.completed);
        let worker_dropped_for_agg = Arc::clone(&worker_dropped);
        let any_dropped = Arc::clone(&any_worker_dropped);
        let app = app.clone();
        let db_pool_worker = db_pool.clone();

        let handle = tokio::spawn(async move {
            process_chunk(
                app,
                worker_id as u32,
                chunk,
                url,
                delay,
                selected_session,
                fuzz_history,
                tx,
                cancel,
                completed,
                worker_dropped,
                worker_completed_counter,
                0, // fresh worker chunk, nothing done yet
                None,
                db_pool_worker,
            )
            .await;
            if worker_dropped_for_agg.load(Ordering::Relaxed) {
                any_dropped.store(true, Ordering::Relaxed);
            }
        });
        handles.push(handle);
    }

    drop(tx);

    for handle in handles {
        let _ = handle.await;
    }

    aggregator.await.ok();

    let final_completed = completed.load(Ordering::Relaxed);
    let conn_dropped = any_worker_dropped.load(Ordering::Relaxed);
    let cancelled = cancel.load(Ordering::Relaxed);

    if cancelled {
        update_store_cancelled(selected_session, fuzz_history).await;
    }

    let status = if cancelled && final_completed < total {
        "cancelled"
    } else if conn_dropped {
        "connection_dropped"
    } else {
        "completed"
    };

    if let Some(ref pool) = db_pool {
        let now = chrono::Utc::now().timestamp_millis();
        let _ = sqlx::query(
            "UPDATE fuzzer_runs SET status = ?, completed = ?, connection_dropped = ?, finished_at = ? WHERE id = ?"
        )
        .bind(status)
        .bind(final_completed as i64)
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
        status,
        conn_dropped,
    );

    // _cleanup_guard drops here (or on early return / panic), removing the
    // cancellation entry exactly once.
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
        let (completed, total) = {
            let store = fuzz_store().lock().await;
            if let Some(run_data) = store.get(&key) {
                let completed = run_data
                    .rows
                    .iter()
                    .filter(|r| r.status == "completed" || r.status == "error")
                    .count() as u32;
                let total = run_data.rows.len() as u32;
                (completed, total)
            } else {
                (0, 0)
            }
        };

        emit_progress(
            &app,
            selected_session,
            fuzz_history,
            completed,
            total,
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
        run_fuzz_targets(app, config, vec![target]).await;
    });

    Ok(())
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzWorkerResumeGroup {
    pub worker_id: u32,
    pub targets: Vec<FuzzTarget>,
    pub worker_already_completed: u32,
    pub worker_original_total: u32,
}

async fn get_failed_worker_groups(session: u32, history: u32) -> Vec<FuzzWorkerResumeGroup> {
    let key = run_key(session, history);
    let store = fuzz_store().lock().await;
    let mut map: HashMap<u32, (Vec<FuzzTarget>, u32, u32)> = HashMap::new();

    if let Some(run_data) = store.get(&key) {
        for row in run_data.rows.iter() {
            let w_id = row.worker_id.unwrap_or(0);
            let entry = map.entry(w_id).or_insert_with(|| (Vec::new(), 0, 0));
            entry.2 += 1; // total
            if row.status == "completed" {
                entry.1 += 1; // completed
            } else if row.status == "error" || row.connection_dropped || row.status == "cancelled" || row.status == "pending" {
                entry.0.push(FuzzTarget {
                    id: row.fuzz_request_id.clone(),
                    request: row.raw_request.clone(),
                });
            }
        }
    }

    map.into_iter()
        .map(|(worker_id, (targets, worker_already_completed, worker_original_total))| {
            FuzzWorkerResumeGroup {
                worker_id,
                targets,
                worker_already_completed,
                worker_original_total,
            }
        })
        .collect()
}

async fn get_failed_worker_targets(session: u32, history: u32, worker_id: u32) -> (Vec<FuzzTarget>, u32, u32) {
    let key = run_key(session, history);
    let store = fuzz_store().lock().await;
    let mut targets = Vec::new();
    let mut already_completed = 0;
    let mut original_total = 0;

    if let Some(run_data) = store.get(&key) {
        for row in run_data.rows.iter() {
            if row.worker_id == Some(worker_id) || (row.worker_id.is_none() && worker_id == 0) {
                original_total += 1;
                if row.status == "completed" {
                    already_completed += 1;
                } else if row.status == "error" || row.connection_dropped || row.status == "cancelled" || row.status == "pending" {
                    targets.push(FuzzTarget {
                        id: row.fuzz_request_id.clone(),
                        request: row.raw_request.clone(),
                    });
                }
            }
        }
    }

    (targets, already_completed, original_total)
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
    let worker_groups = get_failed_worker_groups(selected_session, fuzz_history).await;

    let worker_groups: Vec<_> = worker_groups
        .into_iter()
        .filter(|g| !g.targets.is_empty())
        .collect();

    if worker_groups.is_empty() {
        return Err("No targets to resend".to_string());
    }
    let ids: Vec<String> = worker_groups
        .iter()
        .flat_map(|g| g.targets.iter().map(|t| t.id.clone()))
        .collect();
    update_store_pending(selected_session, fuzz_history, &ids).await;

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    let db_pool_for_task = db_pool.clone();
    tokio::spawn(async move {
        let total = overall_total;
        let completed = Arc::new(AtomicU32::new(already_completed));
        let cancel = register_run(selected_session, fuzz_history).await;
        let _cleanup_guard = CleanupGuard {
            session: selected_session,
            history: fuzz_history,
            flag: Arc::clone(&cancel),
        };

        let any_worker_dropped = Arc::new(AtomicBool::new(false));
        let (tx, mut rx) = mpsc::unbounded_channel::<FuzzUpdate>();

        let mut worker_infos = Vec::new();
        for group in &worker_groups {
            worker_infos.push(WorkerHandleInfo {
                worker_id: group.worker_id,
                completed: Arc::new(AtomicU32::new(group.worker_already_completed)),
                total: group.worker_original_total,
                dropped: Arc::new(AtomicBool::new(false)),
            });
        }

        emit_progress(
            &app,
            selected_session,
            fuzz_history,
            completed.load(Ordering::Relaxed),
            total,
            "running",
            false,
        );

        let agg_app = app.clone();
        let agg_cancel = Arc::clone(&cancel);
        let agg_completed = Arc::clone(&completed);
        let agg_conn_dropped = Arc::clone(&any_worker_dropped);
        let agg_workers = worker_infos.clone();
        let aggregator = tokio::spawn(async move {
            let mut ticker = interval(TIME_TO_UPDATE);
            let mut buffer = Vec::new();
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let done = agg_completed.load(Ordering::Relaxed);
                        let is_cancelled = agg_cancel.load(Ordering::Relaxed);
                        if is_cancelled {
                            update_store_cancelled(selected_session, fuzz_history).await;
                        }
                        let status = if is_cancelled && done < total { "cancelled" } else { "running" };
                        emit_progress(&agg_app, selected_session, fuzz_history, done, total, status, agg_conn_dropped.load(Ordering::Relaxed));
                        for w in &agg_workers {
                            let w_done = w.completed.load(Ordering::Relaxed);
                            let w_dropped = w.dropped.load(Ordering::Relaxed);
                            let w_status = if w_dropped {
                                "dropped"
                            } else if w_done >= w.total || is_cancelled {
                                "completed"
                            } else {
                                "running"
                            };
                            emit_worker_update(
                                &agg_app,
                                selected_session,
                                fuzz_history,
                                w.worker_id,
                                w_status,
                                w_done,
                                w.total,
                                None,
                            );
                        }
                    }
                    maybe_update = rx.recv() => {
                        match maybe_update {
                            Some(update) => buffer.push(update),
                            None => {
                                break;
                            }
                        }
                    }
                }
            }
        });

        let mut handles = vec![];
        for (idx, group) in worker_groups.into_iter().enumerate() {
            let app = app.clone();
            let url = url.clone();
            let tx = tx.clone();
            let cancel = Arc::clone(&cancel);
            let completed = Arc::clone(&completed);
            let worker_info = &worker_infos[idx];
            let worker_dropped = Arc::clone(&worker_info.dropped);
            let worker_completed_counter = Arc::clone(&worker_info.completed);
            let worker_dropped_for_agg = Arc::clone(&worker_dropped);
            let any_dropped = Arc::clone(&any_worker_dropped);
            let db_pool_w = db_pool_for_task.clone();

            let handle = tokio::spawn(async move {
                process_chunk(
                    app,
                    group.worker_id,
                    group.targets,
                    url,
                    delay_ms,
                    selected_session,
                    fuzz_history,
                    tx,
                    cancel,
                    completed,
                    worker_dropped,
                    worker_completed_counter,
                    group.worker_already_completed,
                    Some(group.worker_original_total),
                    db_pool_w,
                )
                .await;
                if worker_dropped_for_agg.load(Ordering::Relaxed) {
                    any_dropped.store(true, Ordering::Relaxed);
                }
            });
            handles.push(handle);
        }

        drop(tx);
        for handle in handles {
            let _ = handle.await;
        }
        aggregator.await.ok();

        let final_completed = completed.load(Ordering::Relaxed);
        let conn_dropped = any_worker_dropped.load(Ordering::Relaxed);
        let cancelled = cancel.load(Ordering::Relaxed);
        if cancelled {
            update_store_cancelled(selected_session, fuzz_history).await;
        }
        let status = if cancelled && final_completed < total {
            "cancelled"
        } else if conn_dropped {
            "connection_dropped"
        } else {
            "completed"
        };

        if let Some(ref pool) = db_pool_for_task {
            let run_id = format!("{}-{}", selected_session, fuzz_history);
            let now = chrono::Utc::now().timestamp_millis();
            let _ = sqlx::query(
                "UPDATE fuzzer_runs SET status = ?, completed = ?, connection_dropped = ?, finished_at = ? WHERE id = ?"
            )
            .bind(status)
            .bind(final_completed as i64)
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
            status,
            conn_dropped,
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn resend_worker_fuzz_requests(
    app: AppHandle,
    url: String,
    selected_session: u32,
    fuzz_history: u32,
    worker_id: u32,
    delay_ms: u64,
    already_completed: u32,
    overall_total: u32,
) -> Result<(), String> {
    let (targets, worker_already_completed, worker_original_total) =
        get_failed_worker_targets(selected_session, fuzz_history, worker_id).await;

    if targets.is_empty() {
        return Err("No targets to resend for this worker".to_string());
    }

    let ids: Vec<String> = targets.iter().map(|t| t.id.clone()).collect();
    update_store_pending(selected_session, fuzz_history, &ids).await;

    let config = FuzzRunConfig {
        url,
        delay_ms,
        num_tasks: 1,
        selected_session,
        fuzz_history,
        register_cancel: false,
        config_snapshot: None,
    };

    let db_pool = if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        db_state.pool().await.ok()
    } else {
        None
    };

    let db_pool_for_task = db_pool.clone();

    // Re-run as a single-worker chunk so status events stay scoped to worker_id.
    tokio::spawn(async move {
        let total = overall_total;
        let completed = Arc::new(AtomicU32::new(already_completed));
        let cancel = register_run(selected_session, fuzz_history).await;
        let _cleanup_guard = CleanupGuard {
            session: selected_session,
            history: fuzz_history,
            flag: Arc::clone(&cancel),
        };
        let worker_dropped = Arc::new(AtomicBool::new(false));
        let worker_completed_counter = Arc::new(AtomicU32::new(worker_already_completed));
        let (tx, mut rx) = mpsc::unbounded_channel::<FuzzUpdate>();

        let agg_app = app.clone();
        let agg_cancel = Arc::clone(&cancel);
        let agg_completed = Arc::clone(&completed);
        let agg_worker_completed = Arc::clone(&worker_completed_counter);
        let agg_worker_dropped = Arc::clone(&worker_dropped);
        let aggregator = tokio::spawn(async move {
            let mut ticker = interval(TIME_TO_UPDATE);
            let mut buffer = Vec::new();
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let done = agg_completed.load(Ordering::Relaxed);
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
                            status,
                            false,
                        );
                        let w_done = agg_worker_completed.load(Ordering::Relaxed);
                        let w_dropped = agg_worker_dropped.load(Ordering::Relaxed);
                        let w_status = if w_dropped {
                            "dropped"
                        } else if w_done >= worker_original_total || is_cancelled {
                            "completed"
                        } else {
                            "running"
                        };
                        emit_worker_update(
                            &agg_app,
                            selected_session,
                            fuzz_history,
                            worker_id,
                            w_status,
                            w_done,
                            worker_original_total,
                            None,
                        );
                    }
                    maybe_update = rx.recv() => {
                        match maybe_update {
                            Some(update) => buffer.push(update),
                            None => {
                                break;
                            }
                        }
                    }
                }
            }
        });

        process_chunk(
            app.clone(),
            worker_id,
            targets,
            config.url,
            config.delay_ms,
            selected_session,
            fuzz_history,
            tx.clone(),
            cancel.clone(),
            Arc::clone(&completed),
            Arc::clone(&worker_dropped),
            worker_completed_counter,
            worker_already_completed,
            Some(worker_original_total),
            db_pool_for_task.clone(),
        )
        .await;

        drop(tx);
        aggregator.await.ok();

        let conn_dropped = worker_dropped.load(Ordering::Relaxed);
        let cancelled = cancel.load(Ordering::Relaxed);
        if cancelled {
            update_store_cancelled(selected_session, fuzz_history).await;
        }
        let done = completed.load(Ordering::Relaxed);
        let status = if cancelled && done < total {
            "cancelled"
        } else if conn_dropped {
            "connection_dropped"
        } else {
            "completed"
        };

        if let Some(ref pool) = db_pool_for_task {
            let run_id = format!("{}-{}", selected_session, fuzz_history);
            let now = chrono::Utc::now().timestamp_millis();
            let _ = sqlx::query(
                "UPDATE fuzzer_runs SET status = ?, completed = ?, connection_dropped = ?, finished_at = ? WHERE id = ?"
            )
            .bind(status)
            .bind(done as i64)
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
            done,
            total,
            status,
            conn_dropped,
        );
    });

    Ok(())
}
