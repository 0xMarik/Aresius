use tauri::AppHandle;

use crate::ares_utils::http_connection::HttpConnection;
use crate::fuzzer::engine::{run_fuzz_targets, FuzzRunConfig, FuzzTarget};
use crate::fuzzer::utils::building_raw_request;
use crate::types::{FuzzerParameter, FuzzerSession};

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

#[tauri::command]
pub async fn execute_combinatorial_fuzzing(
    app: AppHandle,
    session: FuzzerSession,
    num_tasks: usize,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<Vec<FuzzTarget>, String> {
    if session.fuzz_config.parameters.is_empty() {
        return Err("Please add at least one parameter first".to_string());
    }

    let targets = build_combinatorial_fuzz_requests(&session);
    if targets.is_empty() {
        return Err("Please add payload values to the parameter first".to_string());
    }

    let url = session.fuzz_config.metadata.target_url.clone();
    let mut test_conn = HttpConnection::new(&url)
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;
    let _ = test_conn.close().await;

    let returned = targets.clone();

    let config = FuzzRunConfig {
        url,
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
