use tauri::AppHandle;

use crate::ares_utils::http_connection::HttpConnection;
use crate::fuzzer::engine::{run_fuzz_targets, FuzzRunConfig, FuzzTarget};
use crate::fuzzer::preprocessing::{apply_pipeline, get_active_rules};
use crate::fuzzer::utils::{building_raw_request, format_fuzz_request};
use crate::types::FuzzerSession;

fn build_zipped_fuzz_requests(session: &FuzzerSession) -> Vec<FuzzTarget> {
    let mut targets = Vec::new();
    let keep_alive = session.fuzz_config.set_connection_keep_alive.unwrap_or(true);
    let update_cl = session.fuzz_config.update_content_length.unwrap_or(true);

    if session.fuzz_config.parameters.is_empty() {
        return targets;
    }

    let min_length = session
        .fuzz_config
        .parameters
        .iter()
        .map(|p| p.values.len())
        .min()
        .unwrap_or(0);

    let mut sorted_params: Vec<_> = session.fuzz_config.parameters.iter().collect();
    sorted_params.sort_by(|a, b| b.highlight_range.from.cmp(&a.highlight_range.from));

    for i in 0..min_length {
        let mut modified_request = session.fuzz_config.raw_request.clone();
        let mut payload_parts = Vec::new();

        for param in &sorted_params {
            let value = &param.values[i];
            let rules = get_active_rules(session, param);
            let transformed_value = apply_pipeline(value, rules);
            payload_parts.push(transformed_value.clone());
            modified_request =
                building_raw_request(&modified_request, &transformed_value, &param.highlight_range);
        }

        let formatted_request = format_fuzz_request(&modified_request, keep_alive, update_cl);

        targets.push(FuzzTarget {
            id: format!("{}", i),
            request: formatted_request,
            payload: Some(payload_parts.join(", ")),
        });
    }

    targets
}

#[tauri::command]
pub async fn execute_zipped_fuzzing(
    app: AppHandle,
    session: FuzzerSession,
    num_tasks: usize,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<Vec<FuzzTarget>, String> {
    if session.fuzz_config.parameters.is_empty() {
        return Err("Please add at least one parameter first".to_string());
    }

    let targets = build_zipped_fuzz_requests(&session);
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
