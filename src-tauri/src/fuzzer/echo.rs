use tauri::AppHandle;

use crate::fuzzer::engine::{run_fuzz_targets, FuzzRunConfig, FuzzTarget};
use crate::fuzzer::utils::building_raw_request;
use crate::types::FuzzerSession;

fn build_echo_fuzz_requests(session: &FuzzerSession) -> Vec<FuzzTarget> {
    let mut targets = Vec::new();

    let Some(first_param) = session.fuzz_config.parameters.first() else {
        return targets;
    };

    let mut sorted_params: Vec<_> = session.fuzz_config.parameters.iter().collect();
    sorted_params.sort_by(|a, b| b.highlight_range.from.cmp(&a.highlight_range.from));

    for (value_idx, value) in first_param.values.iter().enumerate() {
        let mut modified_request = session.fuzz_config.raw_request.clone();

        for param in &sorted_params {
            modified_request =
                building_raw_request(&modified_request, value, &param.highlight_range);
        }

        targets.push(FuzzTarget {
            id: format!("{}", value_idx),
            request: modified_request,
        });
    }

    targets
}

#[tauri::command]
pub async fn execute_echo_fuzzing(
    app: AppHandle,
    session: FuzzerSession,
    num_tasks: usize,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<Vec<FuzzTarget>, String> {
    let targets = build_echo_fuzz_requests(&session);
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
