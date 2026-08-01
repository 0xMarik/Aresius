use tauri::AppHandle;

use crate::fuzzer::engine::{run_fuzz_targets, FuzzRunConfig, FuzzTarget};
use crate::fuzzer::utils::building_raw_request;
use crate::types::FuzzerSession;

fn build_fuzz_requests(session: &FuzzerSession) -> Vec<FuzzTarget> {
    let mut requests = Vec::new();

    if let Some(first_param) = session.fuzz_config.parameters.first() {
        for (param_idx, param) in session.fuzz_config.parameters.iter().enumerate() {
            for (value_idx, value) in first_param.values.iter().enumerate() {
                let modified_request = building_raw_request(
                    &session.fuzz_config.raw_request,
                    value,
                    &param.highlight_range,
                );
                requests.push(FuzzTarget {
                    id: format!("{}-{}", param_idx, value_idx),
                    request: modified_request,
                });
            }
        }
    }

    requests
}

#[tauri::command]
pub async fn execute_rotator_fuzzing(
    app: AppHandle,
    session: FuzzerSession,
    num_tasks: usize,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<Vec<FuzzTarget>, String> {
    let targets = build_fuzz_requests(&session);
    let returned = targets.clone();

    let config = FuzzRunConfig {
        url: session.fuzz_config.metadata.target_url.clone(),
        delay_ms: session.fuzz_config.delay_ms,
        num_tasks,
        selected_session,
        fuzz_history,
        register_cancel: true,
    };

    tokio::spawn(async move {
        run_fuzz_targets(app, config, targets).await;
    });

    Ok(returned)
}
