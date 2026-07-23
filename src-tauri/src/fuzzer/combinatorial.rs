use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{interval, sleep, Duration};

use crate::fuzzer::utils::building_raw_request;

use crate::{
    http_request::HttpConnection,
    types::{FuzzerParameter, FuzzerSession, ReqRes},
};

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
}

#[derive(Clone, Serialize)]
enum FuzzUpdate {
    Completed(FuzzUpdateCompleted),
    Error(FuzzUpdateError),
}

#[derive(Clone, serde::Serialize)]
pub struct FuzzTarget {
    pub id: String,
    pub request: String,
}

// CLUSTER BOMB: cartesian product of every parameter's value list.
fn generate_combinations(parameters: &[FuzzerParameter]) -> Vec<Vec<String>> {
    if parameters.is_empty() {
        return vec![vec![]];
    }

    let mut result = vec![vec![]];

    for param in parameters {
        let mut new_result = Vec::new();

        for existing_combination in &result {
            for value in &param.values {
                let mut new_combination = existing_combination.clone();
                new_combination.push(value.clone());
                new_result.push(new_combination);
            }
        }

        result = new_result;
    }

    result
}

fn build_combinatorial_fuzz_requests(session: &FuzzerSession) -> Vec<FuzzTarget> {
    let mut targets = Vec::new();

    if session.fuzz_config.parameters.is_empty() {
        return targets;
    }

    let combinations = generate_combinations(&session.fuzz_config.parameters);

    // Doesn't depend on the combination, so sort once outside the loop.
    let mut sorted_params: Vec<_> = session.fuzz_config.parameters.iter().enumerate().collect();
    sorted_params.sort_by(|a, b| b.1.highlight_range.from.cmp(&a.1.highlight_range.from));

    for (combo_idx, combination) in combinations.iter().enumerate() {
        let mut modified_request = session.fuzz_config.raw_request.clone();

        for (param_idx, param) in &sorted_params {
            let value = &combination[*param_idx];
            modified_request =
                building_raw_request(&modified_request, value, &param.highlight_range);
        }

        targets.push(FuzzTarget {
            id: format!("{}", combo_idx),
            request: modified_request,
        });
    }

    targets
}

async fn process_combinatorial_fuzzer_session(
    app: AppHandle,
    session: FuzzerSession,
    targets: Vec<FuzzTarget>,
    num_tasks: usize,
    selected_session: u32,
    fuzz_history: u32,
) -> Vec<ReqRes> {
    let results = Arc::new(Mutex::new(Vec::new()));
    let mut handles = vec![];

    let chunk_size = (targets.len() + num_tasks - 1) / num_tasks;
    let (tx, mut rx) = mpsc::unbounded_channel::<FuzzUpdate>();

    let agg_app = app.clone();
    let aggregator = tokio::spawn(async move {
        let mut ticker = interval(Duration::from_millis(500));
        let mut buffer = Vec::new();
        tracing::debug!("Starting combinatorial fuzz");
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if !buffer.is_empty() {
                        let _ = agg_app.emit("fuzz-update-batch", &buffer);
                        buffer.clear();
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

    for chunk in targets.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let url = session.fuzz_config.metadata.target_url.clone();
        let results = Arc::clone(&results);
        let delay = session.fuzz_config.delay_ms;
        let tx = tx.clone();

        let handle = tokio::spawn(async move {
            let mut conn = match HttpConnection::new(&url).await {
                Ok(conn) => conn,
                Err(e) => {
                    tracing::error!("Connection failed: {}", e);
                    return;
                }
            };

            for target in chunk {
                match conn.send_request(&target.request).await {
                    Ok(response) => {
                        let req_res = ReqRes {
                            request: target.request.clone(),
                            response: response.as_text_lossy(),
                            response_time: response.elapsed.as_millis(),
                        };
                        let _ = tx.send(FuzzUpdate::Completed(FuzzUpdateCompleted {
                            id: target.id.clone(),
                            req_res: req_res.clone(),
                            selected_session: selected_session,
                            fuzz_history: fuzz_history,
                        }));
                        results.lock().await.push(req_res);
                    }
                    Err(e) => {
                        let _ = tx.send(FuzzUpdate::Error(FuzzUpdateError {
                            id: target.id.clone(),
                            message: e.to_string(),
                            selected_session: selected_session,
                            fuzz_history: fuzz_history,
                        }));
                    }
                }
                if delay > 0 {
                    sleep(Duration::from_millis(delay)).await;
                }
            }
        });
        handles.push(handle);
    }

    drop(tx);

    for handle in handles {
        handle.await.unwrap();
    }

    aggregator.await.unwrap();

    Arc::try_unwrap(results).unwrap().into_inner()
}

#[tauri::command]
pub async fn execute_combinatorial_fuzzing(
    app: AppHandle,
    session: FuzzerSession,
    num_tasks: usize,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<Vec<String>, String> {
    let targets = build_combinatorial_fuzz_requests(&session);
    let ids: Vec<String> = targets.iter().map(|t| t.id.clone()).collect();

    tokio::spawn(async move {
        process_combinatorial_fuzzer_session(
            app,
            session,
            targets,
            num_tasks,
            selected_session,
            fuzz_history,
        )
        .await;
    });

    Ok(ids)
}
