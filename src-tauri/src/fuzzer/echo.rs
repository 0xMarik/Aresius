use tauri::AppHandle;

use crate::ares_utils::http_connection::HttpConnection;
use crate::fuzzer::engine::{run_fuzz_targets, FuzzRunConfig, FuzzTarget};
use crate::fuzzer::preprocessing::{apply_pipeline, get_active_rules};
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
        let first_rules = get_active_rules(session, first_param);
        let display_payload = apply_pipeline(value, first_rules);

        for param in &sorted_params {
            let rules = get_active_rules(session, param);
            let transformed_value = apply_pipeline(value, rules);
            modified_request =
                building_raw_request(&modified_request, &transformed_value, &param.highlight_range);
        }

        targets.push(FuzzTarget {
            id: format!("{}", value_idx),
            request: modified_request,
            payload: Some(display_payload),
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
    if session.fuzz_config.parameters.is_empty() {
        return Err("Please add at least one parameter first".to_string());
    }

    let targets = build_echo_fuzz_requests(&session);
    if targets.is_empty() {
        return Err("Please add payload values to the parameter first".to_string());
    }

    let url = session.fuzz_config.metadata.target_url.clone();
    let mut test_conn = HttpConnection::new(&url)
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;
    let _ = test_conn.close().await;

    let returned = targets.clone();

    let config_snapshot = serde_json::to_string(&session.fuzz_config).ok();

    let config = FuzzRunConfig {
        url,
        delay_ms: session.fuzz_config.delay_ms,
        num_tasks,
        selected_session,
        fuzz_history,
        register_cancel: true,
        config_snapshot,
    };

    tokio::spawn(async move {
        run_fuzz_targets(app, config, targets).await;
    });

    Ok(returned)
}
