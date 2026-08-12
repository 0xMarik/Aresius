use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{interval, sleep, Duration};

use crate::ares_utils::http_connection::HttpConnection;
use crate::types::ReqRes;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct FuzzTarget {
    pub id: String,
    pub request: String,
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
}

static FUZZ_CANCELLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

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

async fn cleanup_run(session: u32, history: u32) {
    cancellations()
        .lock()
        .await
        .remove(&run_key(session, history));
}

struct CleanupGuard {
    session: u32,
    history: u32,
    flag: Arc<AtomicBool>, // NEW
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
    worker_completed_offset: u32,
    worker_total_override: Option<u32>,
) {
    let worker_total = worker_total_override.unwrap_or(chunk.len() as u32);
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
                // completed.fetch_add(1, Ordering::Relaxed);
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
            // completed.fetch_add(1, Ordering::Relaxed);
            worker_completed += 1;
            continue;
        }

        match conn.send_request(&target.request.as_bytes()).await {
            Ok(response) => {
                let req_res = ReqRes {
                    request: target.request.clone(),
                    response: response.as_text_lossy(),
                    response_time: response.elapsed.as_millis(),
                };
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
                            let _ = tx.send(FuzzUpdate::Completed(FuzzUpdateCompleted {
                                id: target.id.clone(),
                                req_res,
                                selected_session,
                                fuzz_history,
                            }));
                            completed.fetch_add(1, Ordering::Relaxed);
                            worker_completed += 1;
                            emit_worker_update(
                                &app,
                                selected_session,
                                fuzz_history,
                                worker_id,
                                "running",
                                worker_completed,
                                worker_total,
                                None,
                            );
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
                            worker_dropped.store(true, Ordering::Relaxed);
                            dropped = true;
                            completed.fetch_add(1, Ordering::Relaxed);
                            worker_completed += 1;
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

                if is_conn_err {
                    worker_dropped.store(true, Ordering::Relaxed);
                    dropped = true;
                    emit_worker_update(
                        &app,
                        selected_session,
                        fuzz_history,
                        worker_id,
                        "dropped",
                        worker_completed + 1,
                        worker_total,
                        Some(msg),
                    );
                }
            }
        }

        completed.fetch_add(1, Ordering::Relaxed);
        worker_completed += 1;
        emit_worker_update(
            &app,
            selected_session,
            fuzz_history,
            worker_id,
            if dropped { "dropped" } else { "running" },
            worker_completed,
            worker_total,
            None,
        );

        if delay > 0 && idx + 1 < chunk.len() {
            sleep(Duration::from_millis(delay)).await;
        }
    }

    if !worker_dropped.load(Ordering::Relaxed) && !cancel.load(Ordering::Relaxed) {
        emit_worker_update(
            &app,
            selected_session,
            fuzz_history,
            worker_id,
            "completed",
            worker_total,
            worker_total,
            None,
        );
    } else if cancel.load(Ordering::Relaxed) && !worker_dropped.load(Ordering::Relaxed) {
        emit_worker_update(
            &app,
            selected_session,
            fuzz_history,
            worker_id,
            "completed",
            worker_completed,
            worker_total,
            None,
        );
    }
}

pub async fn run_fuzz_targets(app: AppHandle, config: FuzzRunConfig, targets: Vec<FuzzTarget>) {
    let total = targets.len() as u32;
    let selected_session = config.selected_session;
    let fuzz_history = config.fuzz_history;

    // Guard against the empty-targets panic: `targets.chunks(chunk_size)`
    // below computes chunk_size = 0 when targets is empty (ceil-div of 0 by
    // anything is 0), and `slice::chunks(0)` panics with
    // "chunk size must be non-zero". Bail out early with a clean
    // "completed" progress event instead of crashing the worker thread.
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

    // Ensures cancellations() is cleaned up even if something below panics.
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

    let num_tasks = config.num_tasks.max(1);
    let chunk_size = (targets.len() + num_tasks - 1) / num_tasks;
    let (tx, mut rx) = mpsc::unbounded_channel::<FuzzUpdate>();

    let agg_app = app.clone();
    let agg_completed = Arc::clone(&completed);
    let agg_conn_dropped = Arc::clone(&any_worker_dropped);
    let agg_cancel = Arc::clone(&cancel);

    let aggregator = tokio::spawn(async move {
        let mut ticker = interval(Duration::from_millis(500));
        let mut buffer = Vec::new();
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if !buffer.is_empty() {
                        let _ = agg_app.emit("fuzz-update-batch", &buffer);
                        buffer.clear();
                    }
                    let done = agg_completed.load(Ordering::Relaxed);
                    let status = if agg_cancel.load(Ordering::Relaxed) && done < total {
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

    for (worker_id, chunk) in targets.chunks(chunk_size).enumerate() {
        let chunk = chunk.to_vec();
        let url = config.url.clone();
        let delay = config.delay_ms;
        let tx = tx.clone();
        let cancel = Arc::clone(&cancel);
        let completed = Arc::clone(&completed);
        let worker_dropped = Arc::new(AtomicBool::new(false));
        let worker_dropped_for_agg = Arc::clone(&worker_dropped);
        let any_dropped = Arc::clone(&any_worker_dropped);
        let app = app.clone();

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
                0, // fresh worker chunk, nothing done yet
                None,
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

    let status = if cancelled && final_completed < total {
        "cancelled"
    } else if conn_dropped {
        "connection_dropped"
    } else {
        "completed"
    };

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
pub async fn cancel_fuzzing(selected_session: u32, fuzz_history: u32) -> Result<(), String> {
    if let Some(flag) = get_cancel_flag(selected_session, fuzz_history).await {
        flag.store(true, Ordering::Relaxed);
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
    let config = FuzzRunConfig {
        url,
        delay_ms: 0,
        num_tasks: 1,
        selected_session,
        fuzz_history,
        register_cancel: false,
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

#[tauri::command]
pub async fn resend_failed_fuzz_requests(
    app: AppHandle,
    url: String,
    worker_groups: Vec<FuzzWorkerResumeGroup>,
    selected_session: u32,
    fuzz_history: u32,
    delay_ms: u64,
    already_completed: u32,
    overall_total: u32,
) -> Result<(), String> {
    let worker_groups: Vec<_> = worker_groups
        .into_iter()
        .filter(|g| !g.targets.is_empty())
        .collect();

    if worker_groups.is_empty() {
        return Err("No targets to resend".to_string());
    }

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
        let aggregator = tokio::spawn(async move {
            let mut ticker = interval(Duration::from_millis(500));
            let mut buffer = Vec::new();
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if !buffer.is_empty() {
                            let _ = agg_app.emit("fuzz-update-batch", &buffer);
                            buffer.clear();
                        }
                        let done = agg_completed.load(Ordering::Relaxed);
                        let status = if agg_cancel.load(Ordering::Relaxed) && done < total { "cancelled" } else { "running" };
                        emit_progress(&agg_app, selected_session, fuzz_history, done, total, status, agg_conn_dropped.load(Ordering::Relaxed));
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
        for group in worker_groups {
            let app = app.clone();
            let url = url.clone();
            let tx = tx.clone();
            let cancel = Arc::clone(&cancel);
            let completed = Arc::clone(&completed);
            let worker_dropped = Arc::new(AtomicBool::new(false));
            let worker_dropped_for_agg = Arc::clone(&worker_dropped);
            let any_dropped = Arc::clone(&any_worker_dropped);

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
                    group.worker_already_completed,
                    Some(group.worker_original_total),
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
        let status = if cancelled && final_completed < total {
            "cancelled"
        } else if conn_dropped {
            "connection_dropped"
        } else {
            "completed"
        };

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
    targets: Vec<FuzzTarget>,
    selected_session: u32,
    fuzz_history: u32,
    worker_id: u32,
    delay_ms: u64,
    already_completed: u32,
    overall_total: u32,
    worker_already_completed: u32,
    worker_original_total: u32,
) -> Result<(), String> {
    if targets.is_empty() {
        return Err("No targets to resend for this worker".to_string());
    }

    let config = FuzzRunConfig {
        url,
        delay_ms,
        num_tasks: 1,
        selected_session,
        fuzz_history,
        register_cancel: false,
    };

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
        let (tx, mut rx) = mpsc::unbounded_channel::<FuzzUpdate>();

        let agg_app = app.clone();
        let agg_cancel = Arc::clone(&cancel);
        let agg_completed = Arc::clone(&completed);
        let aggregator = tokio::spawn(async move {
            let mut ticker = interval(Duration::from_millis(500));
            let mut buffer = Vec::new();
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if !buffer.is_empty() {
                            let _ = agg_app.emit("fuzz-update-batch", &buffer);
                            buffer.clear();
                        }
                        let done = agg_completed.load(Ordering::Relaxed);
                        let status = if agg_cancel.load(Ordering::Relaxed) && done < total {
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
            worker_already_completed,
            Some(worker_original_total),
        )
        .await;

        drop(tx);
        aggregator.await.ok();

        let conn_dropped = worker_dropped.load(Ordering::Relaxed);
        let cancelled = cancel.load(Ordering::Relaxed);
        let done = completed.load(Ordering::Relaxed);
        let status = if cancelled && done < total {
            "cancelled"
        } else if conn_dropped {
            "connection_dropped"
        } else {
            "completed"
        };
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
