use tauri::{AppHandle, Manager};

use crate::ares_utils::http_connection::HttpConnection;
use crate::fuzzer::engine::{run_fuzz_targets, FuzzRunConfig, FuzzRunStartResult};
use crate::fuzzer::utils::calculate_total_targets;
use crate::types::FuzzerSession;

#[tauri::command]
pub async fn execute_combinatorial_fuzzing(
    app: AppHandle,
    session: FuzzerSession,
    num_tasks: usize,
    selected_session: u32,
    fuzz_history: u32,
) -> Result<FuzzRunStartResult, String> {
    if session.fuzz_config.parameters.is_empty() {
        return Err("Please add at least one parameter first".to_string());
    }

    let total = calculate_total_targets(&session.fuzz_config);
    if total == 0 {
        return Err("Please add payload values to the parameter first".to_string());
    }

    if let Some(db_state) = app.try_state::<crate::ares_utils::database::DbState>() {
        if let Ok(pool) = db_state.pool().await {
            crate::fuzzer::utils::validate_session_files(&pool, &session.fuzz_config).await?;
        }
    }

    let url = session.fuzz_config.metadata.target_url.clone();
    let mut test_conn = HttpConnection::new(&url)
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;
    let _ = test_conn.close().await;

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
        run_fuzz_targets(app, config, total as u32).await;
    });

    Ok(FuzzRunStartResult {
        total_targets: total as u32,
    })
}
