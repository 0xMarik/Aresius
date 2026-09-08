use crate::ares_utils::database::DbState;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerSessionDb {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub raw_request: String,
    pub attack_type: String,
    pub num_threads: i64,
    pub delay_ms: i64,
    pub target_url: String,
    pub sort_order: i64,
    pub created_at: i64,
    #[sqlx(default)]
    pub pipeline_scope: Option<String>,
    #[sqlx(default)]
    pub pipeline_rules: Option<String>,
    #[sqlx(default)]
    pub set_connection_keep_alive: Option<bool>,
    #[sqlx(default)]
    pub update_content_length: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerParameterDb {
    pub id: String,
    pub session_id: String,
    pub payload_source: String,
    pub range_from: i64,
    pub range_to: i64,
    pub byte_from: i64,
    pub byte_to: i64,
    pub original_text: String,
    pub is_active: bool,
    pub range_id: String,
    pub sort_order: i64,
    #[sqlx(default)]
    pub pipeline_rules: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerParameterValueDb {
    pub id: i64,
    pub parameter_id: String,
    pub value: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerRunDb {
    pub id: String,
    pub session_id: String,
    pub config_snapshot: String,
    pub status: String,
    pub total: i64,
    pub completed: i64,
    pub failed: i64,
    pub completed_base: i64,
    pub connection_dropped: bool,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerRequestDb {
    pub id: String,
    pub run_id: String,
    pub worker_id: Option<i64>,
    pub payload: Option<String>,
    pub status_code: Option<i64>,
    pub response_length: Option<i64>,
    pub response_time_ms: Option<i64>,
    pub request_date: i64,
    pub error_message: Option<String>,
    pub connection_dropped: bool,
    pub sort_order: i64,
    pub chunk_id: Option<i64>,
    pub chunk_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerChunkDb {
    pub id: i64,
    pub run_id: String,
    pub status_code: i64,
    pub compressed_data: Vec<u8>,
    pub uncompressed_bytes: i64,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerFullSession {
    pub session: FuzzerSessionDb,
    pub parameters: Vec<FuzzerParameterWithValues>,
    pub runs: Vec<FuzzerRunDb>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerParameterWithValues {
    pub parameter: FuzzerParameterDb,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerProjectData {
    pub sessions: Vec<FuzzerFullSession>,
    pub selected_session_index: Option<usize>,
    pub expanded_ids: Vec<String>,
    pub ui_state: Option<String>,
}

/// Helper function to parse HTTP status code from raw response string
pub fn parse_status_code(raw_response: &str) -> Option<i64> {
    if raw_response.is_empty() {
        return None;
    }
    raw_response.lines().next().and_then(|line| {
        line.split_whitespace()
            .nth(1)
            .and_then(|code| code.parse::<i64>().ok())
    })
}

/// Fetches all fuzzer sessions, parameters, and run summaries for a project
#[tauri::command]
pub async fn get_fuzzer_project_data(
    db: tauri::State<'_, DbState>,
    project_id: String,
) -> Result<FuzzerProjectData, String> {
    let pool = db.pool().await?;

    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&pool)
            .await
        {
            Ok(Some(pid)) => pid,
            _ => project_id.clone(),
        };

    let sessions = sqlx::query_as::<_, FuzzerSessionDb>(
        "SELECT * FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC",
    )
    .bind(&real_project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let ui_state: Option<String> = sqlx::query_scalar(
        "SELECT ui_state FROM fuzzer_ui_state WHERE project_id = ?"
    )
    .bind(&real_project_id)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    let mut full_sessions = Vec::new();

    for sess in sessions {
        let params = sqlx::query_as::<_, FuzzerParameterDb>(
            "SELECT * FROM fuzzer_parameters WHERE session_id = ? ORDER BY sort_order ASC",
        )
        .bind(&sess.id)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut param_items = Vec::new();
        for param in params {
            let values = sqlx::query_scalar::<_, String>(
                "SELECT value FROM fuzzer_parameter_values WHERE parameter_id = ? ORDER BY sort_order ASC",
            )
            .bind(&param.id)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

            param_items.push(FuzzerParameterWithValues {
                parameter: param,
                values,
            });
        }

        let runs = sqlx::query_as::<_, FuzzerRunDb>(
            "SELECT * FROM fuzzer_runs WHERE session_id = ? ORDER BY started_at ASC",
        )
        .bind(&sess.id)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

        full_sessions.push(FuzzerFullSession {
            session: sess,
            parameters: param_items,
            runs,
        });
    }

    Ok(FuzzerProjectData {
        sessions: full_sessions,
        selected_session_index: None,
        expanded_ids: Vec::new(),
        ui_state,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbFuzzerUiStateRow {
    pub project_id: String,
    pub ui_state: String,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn get_fuzzer_ui_state_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
) -> Result<Option<DbFuzzerUiStateRow>, String> {
    let pool = db.pool().await?;
    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&pool)
            .await
        {
            Ok(Some(pid)) => pid,
            _ => project_id.clone(),
        };

    let row: Option<DbFuzzerUiStateRow> = sqlx::query_as(
        "SELECT project_id, ui_state, updated_at FROM fuzzer_ui_state WHERE project_id = ?"
    )
    .bind(&real_project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row)
}

#[tauri::command]
pub async fn save_fuzzer_ui_state_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
    ui_state: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&pool)
            .await
        {
            Ok(Some(pid)) => pid,
            _ => project_id.clone(),
        };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    sqlx::query(
        "INSERT INTO fuzzer_ui_state (project_id, ui_state, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
            ui_state = excluded.ui_state,
            updated_at = excluded.updated_at"
    )
    .bind(&real_project_id)
    .bind(&ui_state)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn set_fuzzer_session_selection(
    _db: tauri::State<'_, DbState>,
    _project_id: String,
    _session_index: Option<usize>,
    _selected_history_index: Option<i64>,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn set_fuzzer_expanded_ids(
    _db: tauri::State<'_, DbState>,
    _project_id: String,
    _expanded_ids: Vec<String>,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn create_fuzzer_session_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
    name: String,
    target_url: Option<String>,
    raw_request: Option<String>,
) -> Result<String, String> {
    let pool = db.pool().await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
        {
            Some(pid) => pid,
            None => project_id.clone(),
        };

    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM fuzzer_sessions WHERE project_id = ?")
            .bind(&real_project_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or(0);

    sqlx::query(
        "INSERT INTO fuzzer_sessions (id, project_id, name, target_url, raw_request, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&session_id)
    .bind(&real_project_id)
    .bind(&name)
    .bind(target_url.unwrap_or_default())
    .bind(raw_request.unwrap_or_default())
    .bind(count)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(session_id)
}

#[tauri::command]
pub async fn delete_fuzzer_session_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
    session_index: usize,
) -> Result<(), String> {
    let pool = db.pool().await?;

    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&pool)
            .await
        {
            Ok(Some(pid)) => pid,
            _ => project_id.clone(),
        };

    let session_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
    )
    .bind(&real_project_id)
    .bind(session_index as i64)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(s_id) = session_id {
        let run_ids: Vec<String> = sqlx::query_scalar("SELECT id FROM fuzzer_runs WHERE session_id = ?")
            .bind(&s_id)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

        for r_id in &run_ids {
            let _ = sqlx::query("DELETE FROM fuzzer_requests WHERE run_id = ?")
                .bind(r_id)
                .execute(&pool)
                .await;
            let _ = sqlx::query("DELETE FROM fuzzer_chunks WHERE run_id = ?")
                .bind(r_id)
                .execute(&pool)
                .await;
        }

        sqlx::query("DELETE FROM fuzzer_sessions WHERE id = ?")
            .bind(&s_id)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;

        // Clear in-memory decompressed chunk cache
        crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap().clear();

        // VACUUM to defragment and compact SQLite database file
        let _ = sqlx::query("VACUUM").execute(&pool).await;
        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&pool).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_fuzzer_history_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
    session_index: usize,
    history_index: usize,
) -> Result<(), String> {
    let pool = db.pool().await?;

    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&pool)
            .await
        {
            Ok(Some(pid)) => pid,
            _ => project_id.clone(),
        };

    let session_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
    )
    .bind(&real_project_id)
    .bind(session_index as i64)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(s_id) = session_id {
        let run_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM fuzzer_runs WHERE session_id = ? ORDER BY started_at ASC LIMIT 1 OFFSET ?"
        )
        .bind(&s_id)
        .bind(history_index as i64)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;

        if let Some(r_id) = run_id {
            // Explicitly delete requests and chunks to guarantee immediate cascaded FTS trigger cleanup
            let _ = sqlx::query("DELETE FROM fuzzer_requests WHERE run_id = ?")
                .bind(&r_id)
                .execute(&pool)
                .await;
            let _ = sqlx::query("DELETE FROM fuzzer_chunks WHERE run_id = ?")
                .bind(&r_id)
                .execute(&pool)
                .await;
            sqlx::query("DELETE FROM fuzzer_runs WHERE id = ?")
                .bind(&r_id)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;

            // Clear in-memory decompressed chunk cache
            crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap().clear();

            // VACUUM to defragment and compact SQLite database file
            let _ = sqlx::query("VACUUM").execute(&pool).await;
            let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&pool).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn save_fuzzer_session_draft(
    db: tauri::State<'_, DbState>,
    project_id: String,
    session_index: usize,
    name: Option<String>,
    raw_request: Option<String>,
    target_url: Option<String>,
    attack_type: Option<String>,
    num_threads: Option<i64>,
    delay_ms: Option<i64>,
    pipeline_scope: Option<String>,
    pipeline_rules: Option<String>,
    set_connection_keep_alive: Option<bool>,
    update_content_length: Option<bool>,
) -> Result<String, String> {
    let pool = db.pool().await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
        {
            Some(pid) => pid,
            None => project_id.clone(),
        };

    let session_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
    )
    .bind(&real_project_id)
    .bind(session_index as i64)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let s_id = match session_id {
        Some(id) => {
            if let Some(n) = name {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET name = ? WHERE id = ?")
                    .bind(n)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(r) = raw_request {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET raw_request = ? WHERE id = ?")
                    .bind(r)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(u) = target_url {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET target_url = ? WHERE id = ?")
                    .bind(u)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(a) = attack_type {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET attack_type = ? WHERE id = ?")
                    .bind(a)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(t) = num_threads {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET num_threads = ? WHERE id = ?")
                    .bind(t)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(d) = delay_ms {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET delay_ms = ? WHERE id = ?")
                    .bind(d)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(ps) = pipeline_scope {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET pipeline_scope = ? WHERE id = ?")
                    .bind(ps)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(pr) = pipeline_rules {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET pipeline_rules = ? WHERE id = ?")
                    .bind(pr)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(ka) = set_connection_keep_alive {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET set_connection_keep_alive = ? WHERE id = ?")
                    .bind(ka)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            if let Some(ucl) = update_content_length {
                let _ = sqlx::query("UPDATE fuzzer_sessions SET update_content_length = ? WHERE id = ?")
                    .bind(ucl)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await;
            }
            id
        }
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            sqlx::query(
                "INSERT INTO fuzzer_sessions (id, project_id, name, raw_request, target_url, attack_type, num_threads, delay_ms, pipeline_scope, pipeline_rules, set_connection_keep_alive, update_content_length, sort_order, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&new_id)
            .bind(&real_project_id)
            .bind(name.unwrap_or_else(|| format!("Session {}", session_index + 1)))
            .bind(raw_request.unwrap_or_else(|| "GET / HTTP/1.1\r\n\r\n".to_string()))
            .bind(target_url.unwrap_or_default())
            .bind(attack_type.unwrap_or_else(|| "rotator".to_string()))
            .bind(num_threads.unwrap_or(4))
            .bind(delay_ms.unwrap_or(0))
            .bind(pipeline_scope.unwrap_or_else(|| "all".to_string()))
            .bind(pipeline_rules.unwrap_or_else(|| "[]".to_string()))
            .bind(set_connection_keep_alive.unwrap_or(true))
            .bind(update_content_length.unwrap_or(true))
            .bind(session_index as i64)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            new_id
        }
    };

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(s_id)
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerParamPayload {
    pub payload_source: String,
    pub values: Vec<String>,
    pub highlight_range: FuzzerHighlightRangePayload,
    #[serde(default)]
    pub pipeline_rules: Option<Vec<crate::types::PreprocessingRule>>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerHighlightRangePayload {
    pub id: String,
    pub from: usize,
    pub to: usize,
    pub byte_from: usize,
    pub byte_to: usize,
    pub original_text: String,
    pub is_active: bool,
}

#[tauri::command]
pub async fn save_fuzzer_parameters_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
    session_index: usize,
    parameters: Vec<FuzzerParamPayload>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let real_project_id: String =
        match sqlx::query_scalar::<_, String>("SELECT id FROM projects LIMIT 1")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
        {
            Some(pid) => pid,
            None => project_id.clone(),
        };

    let session_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
    )
    .bind(&real_project_id)
    .bind(session_index as i64)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let s_id = match session_id {
        Some(id) => id,
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            sqlx::query(
                "INSERT INTO fuzzer_sessions (id, project_id, name, raw_request, target_url, sort_order, created_at)
                 VALUES (?, ?, ?, 'GET / HTTP/1.1\r\n\r\n', '', ?, ?)"
            )
            .bind(&new_id)
            .bind(&real_project_id)
            .bind(format!("Session {}", session_index + 1))
            .bind(session_index as i64)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            new_id
        }
    };

    // Delete existing parameters for this session
    sqlx::query("DELETE FROM fuzzer_parameters WHERE session_id = ?")
        .bind(&s_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    for (idx, param) in parameters.iter().enumerate() {
        let param_db_id = uuid::Uuid::new_v4().to_string();
        let rules_json = match &param.pipeline_rules {
            Some(r) => serde_json::to_string(r).unwrap_or_else(|_| "[]".into()),
            None => "[]".into(),
        };
        sqlx::query(
            "INSERT INTO fuzzer_parameters
                (id, session_id, payload_source, range_from, range_to, byte_from, byte_to, original_text, is_active, range_id, sort_order, pipeline_rules)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&param_db_id)
        .bind(&s_id)
        .bind(&param.payload_source)
        .bind(param.highlight_range.from as i64)
        .bind(param.highlight_range.to as i64)
        .bind(param.highlight_range.byte_from as i64)
        .bind(param.highlight_range.byte_to as i64)
        .bind(&param.highlight_range.original_text)
        .bind(param.highlight_range.is_active)
        .bind(&param.highlight_range.id)
        .bind(idx as i64)
        .bind(&rules_json)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        for (v_idx, val) in param.values.iter().enumerate() {
            sqlx::query(
                "INSERT INTO fuzzer_parameter_values (parameter_id, value, sort_order) VALUES (?, ?, ?)"
            )
            .bind(&param_db_id)
            .bind(val)
            .bind(v_idx as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Query window of fuzzer requests directly from SQLite with server-side sorting
#[allow(dead_code)]
pub async fn fetch_fuzzer_chunk_responses(
    pool: &SqlitePool,
    chunk_id: i64,
) -> Result<std::sync::Arc<Vec<String>>, String> {
    {
        let mut cache = crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap();
        if let Some(cached) = cache.get(chunk_id) {
            return Ok(cached);
        }
    }

    let blob = fetch_fuzzer_chunk_blob(pool, chunk_id).await?
        .ok_or_else(|| format!("Chunk blob not found for chunk_id: {}", chunk_id))?;

    let responses = tokio::task::spawn_blocking(move || {
        crate::fuzzer::chunk_manager::decompress_chunk(&blob)
    })
    .await
    .map_err(|e| e.to_string())??;

    let mut cache = crate::fuzzer::chunk_manager::get_chunk_cache().lock().unwrap();
    let arc = cache.insert(chunk_id, responses);

    Ok(arc)
}

pub fn sort_fuzzer_db_rows_in_place(rows: &mut [FuzzerRequestDb], sort_by: Option<&str>, is_desc: bool) {
    match sort_by {
        Some("statusCode") | Some("responseCode") => {
            rows.sort_by(|a, b| {
                let cmp = match (a.status_code, b.status_code) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a.sort_order.cmp(&b.sort_order),
                };
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("duration") => {
            rows.sort_by(|a, b| {
                let cmp = match (a.response_time_ms, b.response_time_ms) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a.sort_order.cmp(&b.sort_order),
                };
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("length") => {
            rows.sort_by(|a, b| {
                let cmp = match (a.response_length, b.response_length) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a.sort_order.cmp(&b.sort_order),
                };
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("status") => {
            rows.sort_by(|a, b| {
                let err_a = a.error_message.is_some() || a.connection_dropped;
                let err_b = b.error_message.is_some() || b.connection_dropped;
                let cmp = err_a.cmp(&err_b).then_with(|| a.sort_order.cmp(&b.sort_order));
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("payload") | Some("payloadPreview") => {
            rows.sort_by(|a, b| {
                let p_a = a.payload.as_deref().unwrap_or("");
                let p_b = b.payload.as_deref().unwrap_or("");
                let cmp = p_a.cmp(p_b).then_with(|| a.sort_order.cmp(&b.sort_order));
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("requestDate") => {
            rows.sort_by(|a, b| {
                let cmp = a.request_date.cmp(&b.request_date).then_with(|| a.sort_order.cmp(&b.sort_order));
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        Some("id") => {
            rows.sort_by(|a, b| {
                let cmp = a.sort_order.cmp(&b.sort_order);
                if is_desc { cmp.reverse() } else { cmp }
            });
        }
        _ => {
            rows.sort_by_key(|r| r.sort_order);
            if is_desc {
                rows.reverse();
            }
        }
    }
}

pub async fn query_fuzzer_requests_matching_since(
    pool: &SqlitePool,
    run_id: &str,
    since_date: i64,
    httpql_expr: Option<&crate::ares_utils::httpql::HttpqlExpr>,
    raw_template_req: Option<&str>,
    target_url: Option<&str>,
    provided_config: Option<crate::types::SessionPayload>,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<(Vec<FuzzerRequestDb>, i64), String> {
    let t_fn_start = std::time::Instant::now();
    eprintln!(
        "[FUZZER_SEARCH_BENCH] >>> query_fuzzer_requests_matching_since: run_id={}, since_date={}",
        run_id, since_date
    );

    let mut builder =
        sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE run_id = ");
    builder.push_bind(run_id);
    if since_date > 0 {
        builder.push(" AND request_date >= ");
        builder.push_bind(since_date);
    }
    if let Some(expr) = httpql_expr {
        builder.push(" AND ");
        crate::ares_utils::httpql::compile_fuzzer_httpql_to_sql(&mut builder, expr, raw_template_req, target_url);
    }
    builder.push(" ORDER BY sort_order ASC");

    let t_sql_cand = std::time::Instant::now();
    let candidates = builder
        .build_query_as::<FuzzerRequestDb>()
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    eprintln!(
        "[FUZZER_SEARCH_BENCH]   Step 1: SQL candidates fetched {} rows in {:?}",
        candidates.len(),
        t_sql_cand.elapsed()
    );

    if let Some(ref flag) = cancel_flag {
        if flag.load(std::sync::atomic::Ordering::Relaxed) {
            eprintln!("[FUZZER_SEARCH_BENCH]   Search cancelled after candidate query");
            return Err("Search cancelled".to_string());
        }
    }

    let max_date = candidates.iter().map(|r| r.request_date).max().unwrap_or(since_date);

    let t_cfg = std::time::Instant::now();
    let config_snapshot = if let Some(cfg) = provided_config {
        eprintln!(
            "[FUZZER_SEARCH_BENCH]   Step 2: Config snapshot reused from caller in {:?}",
            t_cfg.elapsed()
        );
        Some(cfg)
    } else {
        let config_snapshot_str: Option<String> = sqlx::query_scalar(
            "SELECT config_snapshot FROM fuzzer_runs WHERE id = ?"
        )
        .bind(run_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        let cfg = config_snapshot_str
            .and_then(|s| serde_json::from_str(&s).ok());
        eprintln!(
            "[FUZZER_SEARCH_BENCH]   Step 2: Config snapshot retrieved from DB in {:?}",
            t_cfg.elapsed()
        );
        cfg
    };

    let (tmpl_method, tmpl_path) = raw_template_req
        .or_else(|| config_snapshot.as_ref().map(|cfg| cfg.raw_request.as_str()))
        .map(|r| {
            let meta = crate::ares_utils::parse::parse_request_line(r.as_bytes());
            (meta.method, meta.path)
        })
        .unwrap_or((String::new(), String::new()));

    let tmpl_host = target_url
        .or_else(|| config_snapshot.as_ref().map(|cfg| cfg.metadata.target_url.as_str()))
        .and_then(|u| url::Url::parse(u).ok())
        .and_then(|url| url.host_str().map(String::from))
        .unwrap_or_default();

    let is_https = target_url
        .or_else(|| config_snapshot.as_ref().map(|cfg| cfg.metadata.target_url.as_str()))
        .map_or(false, |u| u.starts_with("https://"));

    let mut chunk_groups: std::collections::BTreeMap<i64, Vec<FuzzerRequestDb>> = std::collections::BTreeMap::new();
    let mut no_chunk_rows: Vec<FuzzerRequestDb> = Vec::new();

    for row in candidates {
        match row.chunk_id {
            Some(cid) => chunk_groups.entry(cid).or_default().push(row),
            None => no_chunk_rows.push(row),
        }
    }

    let mut filtered = Vec::new();

    let t_no_chunk = std::time::Instant::now();
    for row in no_chunk_rows {
        let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
            row.sort_order as u32,
            row.status_code.unwrap_or(0),
            row.response_length.unwrap_or(0),
            row.response_time_ms.unwrap_or(0),
            row.request_date,
            if row.error_message.is_some() || row.connection_dropped { "error" } else { "pending" },
            None,
            row.payload.as_deref(),
            &row.id,
            config_snapshot.as_ref(),
            &tmpl_method,
            &tmpl_host,
            &tmpl_path,
            is_https,
        );
        if let Some(expr) = httpql_expr {
            if expr.evaluate(&item) {
                filtered.push(row);
            }
        }
    }
    eprintln!(
        "[FUZZER_SEARCH_BENCH]   Step 3: No-chunk rows evaluated in {:?} (matched {})",
        t_no_chunk.elapsed(),
        filtered.len()
    );

    if !chunk_groups.is_empty() {
        if let Some(ref flag) = cancel_flag {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                eprintln!("[FUZZER_SEARCH_BENCH]   Search cancelled before fetching blobs");
                return Err("Search cancelled".to_string());
            }
        }

        let total_chunk_candidates: usize = chunk_groups.values().map(|v| v.len()).sum();
        eprintln!(
            "[FUZZER_SEARCH_BENCH]   Step 4: Beginning batch chunk processing for {} chunks ({} candidates)",
            chunk_groups.len(),
            total_chunk_candidates
        );

        let chunk_ids: Vec<i64> = chunk_groups.keys().copied().collect();
        let t_blobs = std::time::Instant::now();
        let mut blobs_map = fetch_fuzzer_chunk_blobs_batch(pool, &chunk_ids, cancel_flag.as_ref()).await?;
        let total_bytes: usize = blobs_map.values().map(|b| b.len()).sum();
        eprintln!(
            "[FUZZER_SEARCH_BENCH]   Step 4a: Batch fetched {} blobs ({} bytes compressed) in {:?}",
            blobs_map.len(),
            total_bytes,
            t_blobs.elapsed()
        );

        if let Some(ref flag) = cancel_flag {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                eprintln!("[FUZZER_SEARCH_BENCH]   Search cancelled before Rayon spawn");
                return Err("Search cancelled".to_string());
            }
        }

        let mut chunk_tasks: Vec<(i64, Vec<FuzzerRequestDb>, Option<Vec<u8>>)> =
            Vec::with_capacity(chunk_groups.len());
        for (cid, rows) in chunk_groups {
            let blob = blobs_map.remove(&cid);
            chunk_tasks.push((cid, rows, blob));
        }

        let httpql_expr_owned = httpql_expr.cloned();
        let config_snapshot_owned = config_snapshot.clone();
        let tmpl_method_owned = tmpl_method.clone();
        let tmpl_host_owned = tmpl_host.clone();
        let tmpl_path_owned = tmpl_path.clone();
        let cancel_flag_owned = cancel_flag.clone();

        let t_rayon = std::time::Instant::now();
        let matched_chunk_rows: Vec<FuzzerRequestDb> = tokio::task::spawn_blocking(move || {
            use rayon::prelude::*;
            chunk_tasks
                .into_par_iter()
                .flat_map(|(_cid, rows, blob)| {
                    if let Some(ref flag) = cancel_flag_owned {
                        if flag.load(std::sync::atomic::Ordering::Relaxed) {
                            return Vec::new();
                        }
                    }
                    let Some(blob) = blob else {
                        return Vec::new();
                    };
                    let Ok(resps) = crate::fuzzer::chunk_manager::decompress_chunk(&blob) else {
                        return Vec::new();
                    };

                    let mut chunk_matched = Vec::new();
                    for row in rows {
                        if let Some(ref flag) = cancel_flag_owned {
                            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                                return Vec::new();
                            }
                        }
                        if let Some(cidx) = row.chunk_index {
                            if cidx >= 0 && (cidx as usize) < resps.len() {
                                let raw_resp = &resps[cidx as usize];
                                let item = crate::ares_utils::httpql::LazyFuzzerEvaluableItem::new(
                                    row.sort_order as u32,
                                    row.status_code.unwrap_or(0),
                                    row.response_length.unwrap_or(0),
                                    row.response_time_ms.unwrap_or(0),
                                    row.request_date,
                                    if row.error_message.is_some() || row.connection_dropped {
                                        "error"
                                    } else {
                                        "completed"
                                    },
                                    Some(raw_resp.as_str()),
                                    row.payload.as_deref(),
                                    &row.id,
                                    config_snapshot_owned.as_ref(),
                                    &tmpl_method_owned,
                                    &tmpl_host_owned,
                                    &tmpl_path_owned,
                                    is_https,
                                );
                                if let Some(ref expr) = httpql_expr_owned {
                                    if expr.evaluate(&item) {
                                        chunk_matched.push(row);
                                    }
                                } else {
                                    chunk_matched.push(row);
                                }
                            }
                        }
                    }
                    chunk_matched
                })
                .collect()
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Some(ref flag) = cancel_flag {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                eprintln!("[FUZZER_SEARCH_BENCH]   Search cancelled after Rayon execution");
                return Err("Search cancelled".to_string());
            }
        }

        eprintln!(
            "[FUZZER_SEARCH_BENCH]   Step 4b: Rayon parallel decompress + regex matched {} rows in {:?}",
            matched_chunk_rows.len(),
            t_rayon.elapsed()
        );

        filtered.extend(matched_chunk_rows);
        let t_sort = std::time::Instant::now();
        filtered.sort_by_key(|r| r.sort_order);
        eprintln!(
            "[FUZZER_SEARCH_BENCH]   Step 4c: Sorted final {} rows in {:?}",
            filtered.len(),
            t_sort.elapsed()
        );
    }

    eprintln!(
        "[FUZZER_SEARCH_BENCH] <<< query_fuzzer_requests_matching_since FINISHED: total_matched={}, total_duration={:?}",
        filtered.len(),
        t_fn_start.elapsed()
    );

    Ok((filtered, max_date))
}

pub async fn query_fuzzer_requests_all_matching(
    pool: &SqlitePool,
    run_id: &str,
    httpql_expr: Option<&crate::ares_utils::httpql::HttpqlExpr>,
    raw_template_req: Option<&str>,
    target_url: Option<&str>,
) -> Result<Vec<FuzzerRequestDb>, String> {
    query_fuzzer_requests_matching_since(pool, run_id, 0, httpql_expr, raw_template_req, target_url, None, None)
        .await
        .map(|(rows, _)| rows)
}

/// Query window of fuzzer requests directly from SQLite with server-side sorting and two-stage HTTPQL filtering
pub async fn query_fuzzer_requests_window(
    pool: &SqlitePool,
    run_id: &str,
    offset: usize,
    limit: usize,
    sort_by: Option<&str>,
    sort_order: Option<&str>,
    httpql_expr: Option<&crate::ares_utils::httpql::HttpqlExpr>,
    raw_template_req: Option<&str>,
    target_url: Option<&str>,
) -> Result<(usize, Vec<FuzzerRequestDb>), String> {
    let needs_memory_filter = httpql_expr.map_or(false, crate::ares_utils::httpql::has_response_content_checks);

    let is_desc = sort_order
        .map(|s| s.eq_ignore_ascii_case("desc"))
        .unwrap_or(false);
    let dir = if is_desc { "DESC" } else { "ASC" };

    let order_clause = match sort_by {
        Some("statusCode") | Some("responseCode") => {
            format!("status_code {} NULLS LAST, sort_order ASC", dir)
        }
        Some("duration") => format!("response_time_ms {} NULLS LAST, sort_order ASC", dir),
        Some("length") => format!("response_length {} NULLS LAST, sort_order ASC", dir),
        Some("status") => format!("(error_message IS NOT NULL OR connection_dropped = 1) {}, sort_order ASC", dir),
        Some("payload") | Some("payloadPreview") => {
            format!("payload {} NULLS LAST, sort_order ASC", dir)
        }
        Some("requestDate") => format!("request_date {} , sort_order ASC", dir),
        Some("id") => format!("sort_order {}", dir),
        _ => "sort_order ASC".to_string(),
    };

    if needs_memory_filter {
        let mut filtered = query_fuzzer_requests_all_matching(
            pool,
            run_id,
            httpql_expr,
            raw_template_req,
            target_url,
        ).await?;

        sort_fuzzer_db_rows_in_place(&mut filtered, sort_by, is_desc);

        let total = filtered.len();
        let window_rows = filtered.into_iter().skip(offset).take(limit).collect();
        return Ok((total, window_rows));
    }

    // Pure SQL fast path (when no raw or header in-memory evaluation needed)
    let mut count_builder =
        sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT COUNT(*) FROM fuzzer_requests WHERE run_id = ");
    count_builder.push_bind(run_id);
    if let Some(expr) = httpql_expr {
        count_builder.push(" AND ");
        crate::ares_utils::httpql::compile_fuzzer_httpql_to_sql(&mut count_builder, expr, raw_template_req, target_url);
    }
    let total: i64 = count_builder
        .build_query_scalar()
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut builder =
        sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE run_id = ");
    builder.push_bind(run_id);
    if let Some(expr) = httpql_expr {
        builder.push(" AND ");
        crate::ares_utils::httpql::compile_fuzzer_httpql_to_sql(&mut builder, expr, raw_template_req, target_url);
    }
    builder.push(" ORDER BY ");
    builder.push(order_clause);
    builder.push(" LIMIT ");
    builder.push_bind(limit as i64);
    builder.push(" OFFSET ");
    builder.push_bind(offset as i64);

    let rows = builder
        .build_query_as::<FuzzerRequestDb>()
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok((total as usize, rows))
}



#[derive(Debug, Clone)]
pub struct FuzzerCompletedItemMeta {
    pub id: String,
    pub sort_order: i64,
    pub payload: Option<String>,
    pub request_date: i64,
    pub status_code: Option<i64>,
    pub response_length: i64,
    pub response_time_ms: i64,
    pub worker_id: Option<u32>,
}

/// Insert a compressed response chunk into `fuzzer_chunks` and insert the completed requests in a single transaction
pub async fn insert_fuzzer_chunk_and_update_requests(
    pool: &SqlitePool,
    run_id: &str,
    status_code: i64,
    compressed_data: &[u8],
    uncompressed_bytes: i64,
    items: &[FuzzerCompletedItemMeta],
    fts_text: Option<&str>,
) -> Result<i64, String> {
    if items.is_empty() {
        return Ok(0);
    }

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let chunk_id = sqlx::query(
        "INSERT INTO fuzzer_chunks (run_id, status_code, compressed_data, uncompressed_bytes, item_count)
         VALUES (?, ?, ?, ?, ?)"
    )
    .bind(run_id)
    .bind(status_code)
    .bind(compressed_data)
    .bind(uncompressed_bytes)
    .bind(items.len() as i64)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .last_insert_rowid();

    if let Some(text) = fts_text {
        if !text.is_empty() {
            let _ = sqlx::query(
                "INSERT INTO fuzzer_chunks_fts (rowid, body) VALUES (?, ?)"
            )
            .bind(chunk_id)
            .bind(text)
            .execute(&mut *tx)
            .await;
        }
    }

    for (idx, item) in items.iter().enumerate() {
        sqlx::query(
            "INSERT INTO fuzzer_requests
                (id, run_id, worker_id, payload, status_code, response_length, response_time_ms, request_date, error_message, connection_dropped, sort_order, chunk_id, chunk_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
             ON CONFLICT(run_id, id) DO UPDATE SET
                worker_id = excluded.worker_id,
                payload = excluded.payload,
                status_code = excluded.status_code,
                response_length = excluded.response_length,
                response_time_ms = excluded.response_time_ms,
                request_date = excluded.request_date,
                error_message = NULL,
                connection_dropped = 0,
                sort_order = excluded.sort_order,
                chunk_id = excluded.chunk_id,
                chunk_index = excluded.chunk_index"
        )
        .bind(&item.id)
        .bind(run_id)
        .bind(item.worker_id.map(|w| w as i64))
        .bind(&item.payload)
        .bind(item.status_code)
        .bind(item.response_length)
        .bind(item.response_time_ms)
        .bind(item.request_date)
        .bind(item.sort_order)
        .bind(chunk_id)
        .bind(idx as i64)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(chunk_id)
}

/// Query chunk IDs matching a search term using the fuzzer_chunks_fts FTS5 trigram index
pub async fn query_matching_chunks_fts(
    pool: &SqlitePool,
    run_id: &str,
    search_term: &str,
) -> Result<Vec<i64>, String> {
    let trimmed = search_term.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let escaped = format!("\"{}\"", trimmed.replace('"', "\"\""));
    let chunk_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM fuzzer_chunks
         WHERE run_id = ? AND id IN (
             SELECT rowid FROM fuzzer_chunks_fts WHERE fuzzer_chunks_fts MATCH ?
         )"
    )
    .bind(run_id)
    .bind(&escaped)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(chunk_ids)
}

/// Fetch the raw compressed blob for a chunk from `fuzzer_chunks`
pub async fn fetch_fuzzer_chunk_blob(
    pool: &SqlitePool,
    chunk_id: i64,
) -> Result<Option<Vec<u8>>, String> {
    let blob: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT compressed_data FROM fuzzer_chunks WHERE id = ?"
    )
    .bind(chunk_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(blob)
}

#[derive(FromRow)]
struct ChunkBlobRow {
    id: i64,
    compressed_data: Vec<u8>,
}

/// Fetch raw compressed blobs for multiple chunks from `fuzzer_chunks` in batch
pub async fn fetch_fuzzer_chunk_blobs_batch(
    pool: &SqlitePool,
    chunk_ids: &[i64],
    cancel_flag: Option<&std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<std::collections::HashMap<i64, Vec<u8>>, String> {
    if chunk_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let t_start = std::time::Instant::now();
    let mut result = std::collections::HashMap::with_capacity(chunk_ids.len());

    for (batch_idx, batch) in chunk_ids.chunks(500).enumerate() {
        if let Some(flag) = cancel_flag {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                eprintln!(
                    "[FUZZER_SEARCH_BENCH]   fetch_fuzzer_chunk_blobs_batch: Cancelled before batch #{}",
                    batch_idx
                );
                return Err("Search cancelled".to_string());
            }
        }
        let t_batch_start = std::time::Instant::now();
        let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT id, compressed_data FROM fuzzer_chunks WHERE id IN ("
        );
        let mut separated = builder.separated(", ");
        for &id in batch {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");

        let rows: Vec<ChunkBlobRow> = builder
            .build_query_as::<ChunkBlobRow>()
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

        eprintln!(
            "[FUZZER_SEARCH_BENCH]   fetch_fuzzer_chunk_blobs_batch: chunk #{} ({} IDs) fetched in {:?}",
            batch_idx,
            batch.len(),
            t_batch_start.elapsed()
        );

        for row in rows {
            result.insert(row.id, row.compressed_data);
        }
    }

    eprintln!(
        "[FUZZER_SEARCH_BENCH]   fetch_fuzzer_chunk_blobs_batch: total {} blobs retrieved in {:?}",
        result.len(),
        t_start.elapsed()
    );

    Ok(result)
}

/// Insert a single failed/errored fuzzer request in SQLite
pub async fn insert_fuzzer_request_error(
    pool: &SqlitePool,
    run_id: &str,
    request_id: &str,
    sort_order: i64,
    payload: Option<&str>,
    request_date: i64,
    worker_id: Option<u32>,
    message: &str,
    connection_dropped: bool,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO fuzzer_requests
            (id, run_id, worker_id, payload, status_code, response_length, response_time_ms, request_date, error_message, connection_dropped, sort_order, chunk_id, chunk_index)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(run_id, id) DO UPDATE SET
            error_message = excluded.error_message,
            connection_dropped = excluded.connection_dropped,
            request_date = excluded.request_date"
    )
    .bind(request_id)
    .bind(run_id)
    .bind(worker_id.map(|w| w as i64))
    .bind(payload)
    .bind(request_date)
    .bind(message)
    .bind(connection_dropped)
    .bind(sort_order)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Fetch completed requests for a run within a sort_order range
pub async fn fetch_fuzzer_requests_in_range(
    pool: &SqlitePool,
    run_id: &str,
    min_sort: i64,
    max_sort: i64,
) -> Result<Vec<FuzzerRequestDb>, String> {
    sqlx::query_as::<_, FuzzerRequestDb>(
        "SELECT * FROM fuzzer_requests WHERE run_id = ? AND sort_order >= ? AND sort_order < ? ORDER BY sort_order ASC"
    )
    .bind(run_id)
    .bind(min_sort)
    .bind(max_sort)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Fetch all existing sort_order indices for a run
pub async fn fetch_completed_sort_orders(
    pool: &SqlitePool,
    run_id: &str,
) -> Result<std::collections::HashSet<i64>, String> {
    let rows: Vec<(i64,)> = sqlx::query_as(
        "SELECT sort_order FROM fuzzer_requests WHERE run_id = ?"
    )
    .bind(run_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(s,)| s).collect())
}

/// Resolve the actual run_id from session_index and history_index offset in DB
pub async fn resolve_fuzzer_run_id(
    pool: &SqlitePool,
    session_index: usize,
    history_index: usize,
) -> String {
    let direct_id = format!("{}-{}", session_index, history_index);

    // 1. Check if the run exists directly under the standard key format
    let direct_exists: Option<String> = sqlx::query_scalar(
        "SELECT id FROM fuzzer_runs WHERE id = ?"
    )
    .bind(&direct_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    if let Some(r_id) = direct_exists {
        return r_id;
    }

    // 2. Project-scoped session resolution fallback
    let project_id: Option<String> = sqlx::query_scalar("SELECT id FROM projects LIMIT 1")
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

    let session_id: Option<String> = if let Some(ref pid) = project_id {
        sqlx::query_scalar(
            "SELECT id FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
        )
        .bind(pid)
        .bind(session_index as i64)
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
    } else {
        sqlx::query_scalar(
            "SELECT id FROM fuzzer_sessions ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
        )
        .bind(session_index as i64)
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
    };

    if let Some(s_id) = session_id {
        let run_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM fuzzer_runs WHERE session_id = ? ORDER BY started_at ASC LIMIT 1 OFFSET ?"
        )
        .bind(&s_id)
        .bind(history_index as i64)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        if let Some(r_id) = run_id {
            return r_id;
        }
    }

    direct_id
}

/// Load all fuzzer requests for a run from SQLite
pub async fn load_all_fuzzer_requests(
    pool: &SqlitePool,
    run_id: &str,
) -> Result<Vec<FuzzerRequestDb>, String> {
    sqlx::query_as::<_, FuzzerRequestDb>(
        "SELECT * FROM fuzzer_requests WHERE run_id = ? ORDER BY sort_order ASC"
    )
    .bind(run_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        // Minimal fuzzer schema matching 0008_fuzzer.sql
        sqlx::query(
            "CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);
             INSERT INTO projects (id) VALUES ('test-proj');

             CREATE TABLE fuzzer_sessions (
                 id TEXT PRIMARY KEY NOT NULL,
                 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
             );
             INSERT INTO fuzzer_sessions (id, project_id) VALUES ('sess-1', 'test-proj');

             CREATE TABLE fuzzer_runs (
                 id TEXT PRIMARY KEY NOT NULL,
                 session_id TEXT NOT NULL REFERENCES fuzzer_sessions(id) ON DELETE CASCADE,
                 config_snapshot TEXT
             );
             INSERT INTO fuzzer_runs (id, session_id) VALUES ('run-1', 'sess-1');

             CREATE TABLE fuzzer_chunks (
                 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                 run_id TEXT NOT NULL REFERENCES fuzzer_runs(id) ON DELETE CASCADE,
                 status_code INTEGER NOT NULL,
                 compressed_data BLOB NOT NULL,
                 uncompressed_bytes INTEGER NOT NULL,
                 item_count INTEGER NOT NULL
             );

             CREATE VIRTUAL TABLE fuzzer_chunks_fts USING fts5(
                 body,
                 content='',
                 contentless_delete=1,
                 tokenize='trigram'
             );

             CREATE TRIGGER trg_fuzzer_chunks_delete 
             AFTER DELETE ON fuzzer_chunks 
             BEGIN
                 DELETE FROM fuzzer_chunks_fts WHERE rowid = old.id;
             END;

             CREATE TABLE fuzzer_requests (
                 id TEXT NOT NULL,
                 run_id TEXT NOT NULL REFERENCES fuzzer_runs(id) ON DELETE CASCADE,
                 worker_id INTEGER,
                 payload TEXT,
                 status_code INTEGER,
                 response_length INTEGER,
                 response_time_ms INTEGER,
                 request_date INTEGER NOT NULL,
                 error_message TEXT,
                 connection_dropped INTEGER NOT NULL DEFAULT 0,
                 sort_order INTEGER NOT NULL DEFAULT 0,
                 chunk_id INTEGER REFERENCES fuzzer_chunks(id) ON DELETE SET NULL,
                 chunk_index INTEGER,
                 PRIMARY KEY (run_id, id)
             );"
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_fuzzer_chunk_fts_insert_and_query() {
        let pool = create_test_pool().await;

        let items = vec![FuzzerCompletedItemMeta {
            id: "req-1".to_string(),
            sort_order: 0,
            payload: Some("admin".to_string()),
            request_date: 1000,
            status_code: Some(200),
            response_length: 120,
            response_time_ms: 50,
            worker_id: Some(1),
        }];

        let fts_text = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"token\": \"secret_admin_token_123\"}";

        let chunk_id = insert_fuzzer_chunk_and_update_requests(
            &pool,
            "run-1",
            200,
            b"fake_compressed_blob",
            120,
            &items,
            Some(fts_text),
        )
        .await
        .unwrap();

        assert_eq!(chunk_id, 1);

        // Search for trigram inside the token
        let matching_chunks = query_matching_chunks_fts(&pool, "run-1", "secret_admin")
            .await
            .unwrap();
        assert_eq!(matching_chunks, vec![1]);

        // Search for non-existent token
        let no_match = query_matching_chunks_fts(&pool, "run-1", "nonexistent_xyz")
            .await
            .unwrap();
        assert!(no_match.is_empty());

        // Test delete trigger synchronization
        sqlx::query("DELETE FROM fuzzer_chunks WHERE id = 1;")
            .execute(&pool)
            .await
            .unwrap();

        let after_delete = query_matching_chunks_fts(&pool, "run-1", "secret_admin")
            .await
            .unwrap();
        assert!(after_delete.is_empty());
    }

    #[tokio::test]
    async fn test_query_fuzzer_requests_window_httpql() {
        let pool = create_test_pool().await;

        let items = vec![
            FuzzerCompletedItemMeta {
                id: "req-1".to_string(),
                sort_order: 0,
                payload: Some("admin".to_string()),
                request_date: 1000,
                status_code: Some(200),
                response_length: 500,
                response_time_ms: 30,
                worker_id: Some(1),
            },
            FuzzerCompletedItemMeta {
                id: "req-2".to_string(),
                sort_order: 1,
                payload: Some("guest".to_string()),
                request_date: 1001,
                status_code: Some(404),
                response_length: 120,
                response_time_ms: 150,
                worker_id: Some(1),
            },
            FuzzerCompletedItemMeta {
                id: "req-3".to_string(),
                sort_order: 2,
                payload: Some("root".to_string()),
                request_date: 1002,
                status_code: Some(200),
                response_length: 1500,
                response_time_ms: 80,
                worker_id: Some(1),
            },
        ];

        let raw_resps = vec![
            "HTTP/1.1 200 OK\r\nServer: nginx\r\n\r\nHello req 1".to_string(),
            "HTTP/1.1 404 Not Found\r\nServer: apache\r\n\r\nNot found".to_string(),
            "HTTP/1.1 200 OK\r\nServer: nginx\r\n\r\n{\"secret\": \"admin_flag_123\"}".to_string(),
        ];
        let compressed = crate::fuzzer::chunk_manager::compress_chunk(&raw_resps).unwrap();
        let fts_text = raw_resps.join("\n");

        insert_fuzzer_chunk_and_update_requests(
            &pool,
            "run-1",
            200,
            &compressed,
            2120,
            &items,
            Some(&fts_text),
        )
        .await
        .unwrap();

        // 1. Query resp.code:200
        let q1 = crate::ares_utils::httpql::parse_httpql("resp.code:200").unwrap().unwrap();
        let (total1, rows1) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q1), None, None
        ).await.unwrap();
        assert_eq!(total1, 2);
        assert_eq!(rows1.len(), 2);

        // 2. Query resp.len.gt:1000
        let q2 = crate::ares_utils::httpql::parse_httpql("resp.len.gt:1000").unwrap().unwrap();
        let (total2, rows2) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q2), None, None
        ).await.unwrap();
        assert_eq!(total2, 1);
        assert_eq!(rows2[0].id, "req-3");

        // 3. Query resp.roundtrip.lt:50
        let q3 = crate::ares_utils::httpql::parse_httpql("resp.roundtrip.lt:50").unwrap().unwrap();
        let (total3, rows3) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q3), None, None
        ).await.unwrap();
        assert_eq!(total3, 1);
        assert_eq!(rows3[0].id, "req-1");

        // 4. Query combined header: resp.code:200 and resp.header["server"].cont:"nginx"
        let q4 = crate::ares_utils::httpql::parse_httpql("resp.code:200 and resp.header[\"server\"].cont:\"nginx\"").unwrap().unwrap();
        let (total4, rows4) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q4), None, None
        ).await.unwrap();
        assert_eq!(total4, 2);
        assert_eq!(rows4.len(), 2);

        // 5. Query body search: resp.body.cont:"admin_flag_123"
        let q5 = crate::ares_utils::httpql::parse_httpql("resp.body.cont:\"admin_flag_123\"").unwrap().unwrap();
        let (total5, rows5) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q5), None, None
        ).await.unwrap();
        assert_eq!(total5, 1);
        assert_eq!(rows5[0].id, "req-3");

        // 6. Query incremental matching with regex (resp.raw.regex:.404.)
        let q6 = crate::ares_utils::httpql::parse_httpql("resp.raw.regex:.404.").unwrap().unwrap();
        let (since_rows1, max_date1) = query_fuzzer_requests_matching_since(
            &pool, "run-1", 0, Some(&q6), None, None, None, None
        ).await.unwrap();
        assert_eq!(since_rows1.len(), 1);
        assert_eq!(since_rows1[0].id, "req-2");
        assert_eq!(max_date1, 1002);

        let config_obj = crate::types::SessionPayload {
            raw_request: "GET /search?q=\u{00a7}FUZZ\u{00a7} HTTP/1.1\r\nHost: example.com\r\n\r\n".to_string(),
            parameters: vec![crate::types::FuzzerParameter {
                payload_source: "manual".to_string(),
                values: vec!["admin".to_string(), "guest".to_string(), "root".to_string()],
                highlight_range: crate::types::HighlightRange {
                    id: "p1".to_string(),
                    from: 14,
                    to: 22,
                    byte_from: 14,
                    byte_to: 22,
                    original_text: "\u{00a7}FUZZ\u{00a7}".to_string(),
                    is_active: true,
                },
                pipeline_rules: None,
                file_config: None,
            }],
            metadata: crate::types::PayloadMetadata {
                target_url: "https://example.com/search?q=%C2%A7FUZZ%C2%A7".to_string(),
                url_is_valid: Some(true),
            },
            delay_ms: 0,
            fuzzing_attack_type: Some("rotator".to_string()),
            num_threads: Some(1),
            pipeline_scope: Some("all".to_string()),
            pipeline_rules: None,
            set_connection_keep_alive: Some(true),
            update_content_length: Some(true),
        };
        let tmpl_json = serde_json::to_string(&config_obj).unwrap();

        sqlx::query("UPDATE fuzzer_runs SET config_snapshot = ? WHERE id = ?")
            .bind(&tmpl_json)
            .bind("run-1")
            .execute(&pool)
            .await
            .unwrap();

        let (since_rows2, _) = query_fuzzer_requests_matching_since(
            &pool, "run-1", 1003, Some(&q6), None, None, None, None
        ).await.unwrap();
        assert_eq!(since_rows2.len(), 0);

        // 7. Query dynamic reconstructed request: req.query.cont:"q=admin"
        let q7 = crate::ares_utils::httpql::parse_httpql("req.query.cont:\"q=admin\"").unwrap().unwrap();
        let (total7, rows7) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q7), None, None
        ).await.unwrap();
        assert_eq!(total7, 1);
        assert_eq!(rows7[0].id, "req-1");

        // 8. Query dynamic reconstructed request: req.query.cont:"q=guest"
        let q8 = crate::ares_utils::httpql::parse_httpql("req.query.cont:\"q=guest\"").unwrap().unwrap();
        let (total8, rows8) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q8), None, None
        ).await.unwrap();
        assert_eq!(total8, 1);
        assert_eq!(rows8[0].id, "req-2");

        // 9. Query dynamic reconstructed path: req.path:"/search"
        let q9 = crate::ares_utils::httpql::parse_httpql("req.path:\"/search\"").unwrap().unwrap();
        let (total9, rows9) = query_fuzzer_requests_window(
            &pool, "run-1", 0, 10, None, None, Some(&q9), None, None
        ).await.unwrap();
        assert_eq!(total9, 3);
        assert_eq!(rows9.len(), 3);
    }

    #[tokio::test]
    async fn test_delete_fuzzer_run_and_vacuum() {
        let pool = create_test_pool().await;

        let items = vec![FuzzerCompletedItemMeta {
            id: "req-1".to_string(),
            sort_order: 0,
            payload: Some("test_payload".to_string()),
            request_date: 1000,
            status_code: Some(200),
            response_length: 500,
            response_time_ms: 30,
            worker_id: Some(1),
        }];
        let raw_resps = vec!["HTTP/1.1 200 OK\r\n\r\nHello".to_string()];
        let compressed = crate::fuzzer::chunk_manager::compress_chunk(&raw_resps).unwrap();

        let chunk_id = insert_fuzzer_chunk_and_update_requests(
            &pool,
            "run-1",
            200,
            &compressed,
            500,
            &items,
            Some("HTTP/1.1 200 OK\r\n\r\nHello"),
        )
        .await
        .unwrap();

        assert_eq!(chunk_id, 1);

        // Verify inserted
        let chunk_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fuzzer_chunks WHERE run_id = 'run-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(chunk_count, 1);

        let req_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fuzzer_requests WHERE run_id = 'run-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(req_count, 1);

        // Delete run with explicit cascades and vacuum
        let _ = sqlx::query("DELETE FROM fuzzer_requests WHERE run_id = 'run-1'").execute(&pool).await;
        let _ = sqlx::query("DELETE FROM fuzzer_chunks WHERE run_id = 'run-1'").execute(&pool).await;
        let _ = sqlx::query("DELETE FROM fuzzer_runs WHERE id = 'run-1'").execute(&pool).await;

        // Execute VACUUM and WAL checkpoint
        let _ = sqlx::query("VACUUM").execute(&pool).await.unwrap();
        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&pool).await.unwrap();

        // Verify all tables are empty
        let chunk_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fuzzer_chunks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(chunk_count_after, 0);

        let req_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fuzzer_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(req_count_after, 0);

        let fts_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fuzzer_chunks_fts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fts_count_after, 0);
    }

    #[tokio::test]
    async fn test_search_cancellation_aborts_chunk_search() {
        let pool = create_test_pool().await;
        let cancel_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let q = crate::ares_utils::httpql::parse_httpql("resp.raw.regex:.404.").unwrap().unwrap();
        let res = query_fuzzer_requests_matching_since(
            &pool, "run-1", 0, Some(&q), None, None, None, Some(cancel_flag)
        ).await;
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "Search cancelled");
    }
}

