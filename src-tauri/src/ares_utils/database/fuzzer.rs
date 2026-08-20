use crate::ares_utils::database::DbState;
use crate::types::ReqRes;
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
    pub is_expanded: bool,
    pub is_selected: bool,
    pub selected_history_index: Option<i64>,
    pub created_at: i64,
    #[sqlx(default)]
    pub pipeline_scope: Option<String>,
    #[sqlx(default)]
    pub pipeline_rules: Option<String>,
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
    pub raw_request: String,
    pub raw_response: Option<String>,
    pub status_code: Option<i64>,
    pub response_length: Option<i64>,
    pub response_time_ms: Option<i64>,
    pub request_date: i64,
    pub status: String,
    pub error_message: Option<String>,
    pub connection_dropped: bool,
    pub sort_order: i64,
    pub payload: Option<String>,
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

    let mut selected_session_index: Option<usize> = None;
    let mut expanded_ids = Vec::new();

    for (idx, sess) in sessions.iter().enumerate() {
        if sess.is_selected {
            selected_session_index = Some(idx);
        }
        if sess.is_expanded {
            expanded_ids.push(idx.to_string());
        }
    }

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
        selected_session_index,
        expanded_ids,
    })
}

#[tauri::command]
pub async fn set_fuzzer_session_selection(
    db: tauri::State<'_, DbState>,
    project_id: String,
    session_index: Option<usize>,
    selected_history_index: Option<i64>,
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

    sqlx::query("UPDATE fuzzer_sessions SET is_selected = 0 WHERE project_id = ?")
        .bind(&real_project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(s_idx) = session_index {
        let session_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
        )
        .bind(&real_project_id)
        .bind(s_idx as i64)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        if let Some(s_id) = session_id {
            sqlx::query(
                "UPDATE fuzzer_sessions SET is_selected = 1, selected_history_index = ? WHERE id = ?"
            )
            .bind(selected_history_index)
            .bind(&s_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_fuzzer_expanded_ids(
    db: tauri::State<'_, DbState>,
    project_id: String,
    expanded_ids: Vec<String>,
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

    let sessions = sqlx::query_as::<_, FuzzerSessionDb>(
        "SELECT * FROM fuzzer_sessions WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC"
    )
    .bind(&real_project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    for (idx, sess) in sessions.into_iter().enumerate() {
        let is_expanded =
            expanded_ids.contains(&idx.to_string()) || expanded_ids.contains(&sess.id);
        sqlx::query("UPDATE fuzzer_sessions SET is_expanded = ? WHERE id = ?")
            .bind(is_expanded)
            .bind(&sess.id)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
    }

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

    sqlx::query("UPDATE fuzzer_sessions SET is_selected = 0 WHERE project_id = ?")
        .bind(&real_project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO fuzzer_sessions (id, project_id, name, target_url, raw_request, sort_order, is_selected, is_expanded, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)"
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
        sqlx::query("DELETE FROM fuzzer_sessions WHERE id = ?")
            .bind(&s_id)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
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
            sqlx::query("DELETE FROM fuzzer_runs WHERE id = ?")
                .bind(&r_id)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
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
            id
        }
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            sqlx::query(
                "INSERT INTO fuzzer_sessions (id, project_id, name, raw_request, target_url, attack_type, num_threads, delay_ms, pipeline_scope, pipeline_rules, sort_order, is_selected, is_expanded, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)"
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
                "INSERT INTO fuzzer_sessions (id, project_id, name, raw_request, target_url, sort_order, is_selected, is_expanded, created_at)
                 VALUES (?, ?, ?, 'GET / HTTP/1.1\r\n\r\n', '', ?, 1, 1, ?)"
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
pub async fn query_fuzzer_requests_window(
    pool: &SqlitePool,
    run_id: &str,
    offset: usize,
    limit: usize,
    sort_by: Option<&str>,
    sort_order: Option<&str>,
) -> Result<(usize, Vec<FuzzerRequestDb>), String> {
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fuzzer_requests WHERE run_id = ?")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

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
        Some("status") => format!("status {} , sort_order ASC", dir),
        Some("payload") | Some("payloadPreview") => {
            format!("payload {} NULLS LAST, sort_order ASC", dir)
        }
        Some("requestDate") => format!("request_date {} , sort_order ASC", dir),
        Some("id") => format!("sort_order {}", dir),
        _ => "sort_order ASC".to_string(),
    };

    let mut builder =
        sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT * FROM fuzzer_requests WHERE run_id = ");
    builder.push_bind(run_id);
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

/// Batch insert target requests into SQLite in a single transaction
pub async fn batch_insert_fuzzer_requests(
    pool: &SqlitePool,
    run_id: &str,
    targets: &[(String, String, Option<u32>, Option<String>)], // (id, raw_request, worker_id, payload)
) -> Result<(), String> {
    if targets.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();

    for (idx, (id, req, worker_id, payload)) in targets.iter().enumerate() {
        sqlx::query(
            "INSERT INTO fuzzer_requests
                (id, run_id, worker_id, raw_request, payload, request_date, status, connection_dropped, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(run_id, id) DO UPDATE SET
                raw_request = excluded.raw_request,
                payload = excluded.payload,
                request_date = excluded.request_date,
                status = 'pending',
                connection_dropped = 0,
                error_message = NULL",
        )
        .bind(id)
        .bind(run_id)
        .bind(worker_id.map(|w| w as i64))
        .bind(req)
        .bind(payload)
        .bind(now)
        .bind("pending")
        .bind(false)
        .bind(idx as i64)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Update a single completed fuzzer request in SQLite
pub async fn update_fuzzer_request_completed(
    pool: &SqlitePool,
    run_id: &str,
    request_id: &str,
    req_res: &ReqRes,
) -> Result<(), String> {
    let status_code = parse_status_code(&req_res.response);
    let response_len = req_res.response.len() as i64;
    let resp_time = req_res.response_time as i64;

    sqlx::query(
        "UPDATE fuzzer_requests
         SET raw_request = ?,
             raw_response = ?,
             status_code = ?,
             response_length = ?,
             response_time_ms = ?,
             status = 'completed',
             error_message = NULL,
             connection_dropped = 0
         WHERE run_id = ? AND id = ?",
    )
    .bind(&req_res.request)
    .bind(&req_res.response)
    .bind(status_code)
    .bind(response_len)
    .bind(resp_time)
    .bind(run_id)
    .bind(request_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Update a single failed/errored fuzzer request in SQLite
pub async fn update_fuzzer_request_error(
    pool: &SqlitePool,
    run_id: &str,
    request_id: &str,
    message: &str,
    connection_dropped: bool,
    request: Option<&str>,
) -> Result<(), String> {
    if let Some(req) = request {
        sqlx::query(
            "UPDATE fuzzer_requests
             SET raw_request = ?,
                 status = 'error',
                 error_message = ?,
                 connection_dropped = ?
             WHERE run_id = ? AND id = ?",
        )
        .bind(req)
        .bind(message)
        .bind(connection_dropped)
        .bind(run_id)
        .bind(request_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        sqlx::query(
            "UPDATE fuzzer_requests
             SET status = 'error',
                 error_message = ?,
                 connection_dropped = ?
             WHERE run_id = ? AND id = ?",
        )
        .bind(message)
        .bind(connection_dropped)
        .bind(run_id)
        .bind(request_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Resolve the actual run_id from session_index and history_index offset in DB
pub async fn resolve_fuzzer_run_id(
    pool: &SqlitePool,
    session_index: usize,
    history_index: usize,
) -> String {
    let session_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM fuzzer_sessions ORDER BY sort_order ASC, created_at ASC LIMIT 1 OFFSET ?"
    )
    .bind(session_index as i64)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

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

    format!("{}-{}", session_index, history_index)
}

/// Update pending fuzzer requests to 'cancelled' in SQLite
pub async fn cancel_pending_fuzzer_requests(
    pool: &SqlitePool,
    run_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE fuzzer_requests SET status = 'cancelled' WHERE run_id = ? AND status = 'pending'"
    )
    .bind(run_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
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
