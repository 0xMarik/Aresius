use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use crate::ares_utils::database::DbState;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerCollectionRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub sort_order: i64,
    pub is_expanded: i64,
    pub is_selected: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerSessionRow {
    pub id: String,
    pub collection_id: String,
    pub name: String,
    pub base_url: String,
    pub request_tmp: String,
    pub sort_order: i64,
    pub is_selected: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerHistoryRow {
    pub id: String,
    pub session_id: String,
    pub request_raw: String,
    pub response_raw: String,
    pub response_time: i64,
    pub created_at: String,
    pub sort_order: i64,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerHistoryItemFull {
    pub id: String,
    pub request_raw: String,
    pub response_raw: String,
    pub response_time: i64,
    pub created_at: String,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerSessionFull {
    pub id: String,
    pub name: String,
    pub url: String,
    pub request_tmp: String,
    pub history: Vec<ReplayerHistoryItemFull>,
    pub selected_history_index: Option<usize>,
    pub url_is_valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerCollectionFull {
    pub id: String,
    pub name: String,
    pub is_expanded: bool,
    pub sessions: Vec<ReplayerSessionFull>,
    pub selected_session_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerFullData {
    pub collections: Vec<ReplayerCollectionFull>,
    pub selected_collection_index: usize,
    pub expanded_ids: Vec<String>,
}

#[tauri::command]
pub async fn get_replayer_data(
    db: tauri::State<'_, DbState>,
    project_id: String,
) -> Result<ReplayerFullData, String> {
    let pool = db.pool().await?;

    let collections = sqlx::query_as::<_, ReplayerCollectionRow>(
        "SELECT id, project_id, name, sort_order, is_expanded, is_selected FROM replayer_collections WHERE project_id = ? ORDER BY sort_order ASC, rowid ASC",
    )
    .bind(&project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if collections.is_empty() {
        // Initialize default collection + session in SQLite
        let col_id = uuid::Uuid::new_v4().to_string();
        let sess_id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO replayer_collections (id, project_id, name, sort_order, is_expanded, is_selected) VALUES (?, ?, ?, 0, 1, 1)",
        )
        .bind(&col_id)
        .bind(&project_id)
        .bind("Default Collection")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT INTO replayer_sessions (id, collection_id, name, base_url, request_tmp, sort_order, is_selected) VALUES (?, ?, ?, ?, ?, 0, 1)",
        )
        .bind(&sess_id)
        .bind(&col_id)
        .bind("Session 1")
        .bind("https://")
        .bind("GET / HTTP/1.1\r\n\r\n")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

        return Ok(ReplayerFullData {
            collections: vec![ReplayerCollectionFull {
                id: col_id.clone(),
                name: "Default Collection".to_string(),
                is_expanded: true,
                sessions: vec![ReplayerSessionFull {
                    id: sess_id,
                    name: "Session 1".to_string(),
                    url: "https://".to_string(),
                    request_tmp: "GET / HTTP/1.1\r\n\r\n".to_string(),
                    history: vec![],
                    selected_history_index: None,
                    url_is_valid: false,
                }],
                selected_session_index: Some(0),
            }],
            selected_collection_index: 0,
            expanded_ids: vec![col_id],
        });
    }

    let mut full_collections = Vec::new();
    let mut selected_collection_idx = 0;
    let mut expanded_ids = Vec::new();

    for (col_idx, col_row) in collections.into_iter().enumerate() {
        if col_row.is_selected == 1 {
            selected_collection_idx = col_idx;
        }

        let is_expanded = col_row.is_expanded != 0;
        if is_expanded {
            expanded_ids.push(col_row.id.clone());
        }

        let sessions = sqlx::query_as::<_, ReplayerSessionRow>(
            "SELECT id, collection_id, name, base_url, request_tmp, sort_order, is_selected FROM replayer_sessions WHERE collection_id = ? ORDER BY sort_order ASC, rowid ASC",
        )
        .bind(&col_row.id)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut full_sessions = Vec::new();
        let mut selected_session_idx: Option<usize> = None;

        for (sess_idx, sess_row) in sessions.into_iter().enumerate() {
            if sess_row.is_selected == 1 && selected_session_idx.is_none() {
                selected_session_idx = Some(sess_idx);
            }

            let histories = sqlx::query_as::<_, ReplayerHistoryRow>(
                "SELECT id, session_id, request_raw, response_raw, response_time, created_at, sort_order, status, error_message FROM replayer_history WHERE session_id = ? ORDER BY sort_order ASC, rowid DESC",
            )
            .bind(&sess_row.id)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

            let full_histories: Vec<ReplayerHistoryItemFull> = histories
                .into_iter()
                .map(|h| {
                    let mut status = h.status;
                    if status.is_empty() {
                        if h.error_message.is_some() {
                            status = "Error".to_string();
                        } else if let Some(first_line) = h.response_raw.lines().next() {
                            if let Some(code) = first_line.split_whitespace().nth(1) {
                                if code.chars().all(|c| c.is_ascii_digit()) {
                                    status = code.to_string();
                                }
                            }
                        }
                    }
                    ReplayerHistoryItemFull {
                        id: h.id,
                        request_raw: h.request_raw,
                        response_raw: h.response_raw,
                        response_time: h.response_time,
                        created_at: h.created_at,
                        status,
                        error_message: h.error_message,
                    }
                })
                .collect();

            let has_history = !full_histories.is_empty();
            let url_is_valid = !sess_row.base_url.is_empty() && sess_row.base_url != "https://";

            full_sessions.push(ReplayerSessionFull {
                id: sess_row.id,
                name: sess_row.name,
                url: sess_row.base_url,
                request_tmp: sess_row.request_tmp,
                history: full_histories,
                selected_history_index: if has_history { Some(0) } else { None },
                url_is_valid,
            });
        }

        let has_sessions = !full_sessions.is_empty();
        if selected_session_idx.is_none() && has_sessions {
            selected_session_idx = Some(0);
        }

        full_collections.push(ReplayerCollectionFull {
            id: col_row.id,
            name: col_row.name,
            is_expanded,
            sessions: full_sessions,
            selected_session_index: selected_session_idx,
        });
    }

    if selected_collection_idx >= full_collections.len() && !full_collections.is_empty() {
        selected_collection_idx = 0;
    }

    Ok(ReplayerFullData {
        collections: full_collections,
        selected_collection_index: selected_collection_idx,
        expanded_ids,
    })
}

#[tauri::command]
pub async fn create_replayer_collection(
    db: tauri::State<'_, DbState>,
    project_id: String,
    collection_id: String,
    name: String,
    sort_order: i64,
) -> Result<(), String> {
    let pool = db.pool().await?;

    // Mark other collections as not selected
    let _ = sqlx::query("UPDATE replayer_collections SET is_selected = 0 WHERE project_id = ?")
        .bind(&project_id)
        .execute(&pool)
        .await;

    sqlx::query(
        "INSERT INTO replayer_collections (id, project_id, name, sort_order, is_expanded, is_selected) VALUES (?, ?, ?, ?, 1, 1)",
    )
    .bind(&collection_id)
    .bind(&project_id)
    .bind(&name)
    .bind(sort_order)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn rename_replayer_collection(
    db: tauri::State<'_, DbState>,
    collection_id: String,
    name: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query("UPDATE replayer_collections SET name = ? WHERE id = ?")
        .bind(&name)
        .bind(&collection_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_replayer_collection(
    db: tauri::State<'_, DbState>,
    collection_id: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query("DELETE FROM replayer_collections WHERE id = ?")
        .bind(&collection_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_replayer_collection_expanded(
    db: tauri::State<'_, DbState>,
    collection_id: String,
    is_expanded: bool,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query("UPDATE replayer_collections SET is_expanded = ? WHERE id = ?")
        .bind(if is_expanded { 1i64 } else { 0i64 })
        .bind(&collection_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_replayer_expanded_ids(
    db: tauri::State<'_, DbState>,
    project_id: String,
    expanded_ids: Vec<String>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Collapse all collections for this project first
    sqlx::query("UPDATE replayer_collections SET is_expanded = 0 WHERE project_id = ?")
        .bind(&project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Expand the specified collections
    for col_id in expanded_ids {
        sqlx::query("UPDATE replayer_collections SET is_expanded = 1 WHERE id = ? AND project_id = ?")
            .bind(&col_id)
            .bind(&project_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_replayer_active_selection(
    db: tauri::State<'_, DbState>,
    project_id: String,
    collection_id: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    if let Some(col_id) = &collection_id {
        sqlx::query("UPDATE replayer_collections SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE project_id = ?")
            .bind(col_id)
            .bind(&project_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(sess_id) = &session_id {
        sqlx::query(
            "UPDATE replayer_sessions SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE collection_id IN (SELECT id FROM replayer_collections WHERE project_id = ?)",
        )
        .bind(sess_id)
        .bind(&project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn create_replayer_session(
    db: tauri::State<'_, DbState>,
    collection_id: String,
    session_id: String,
    name: String,
    base_url: String,
    request_tmp: String,
    sort_order: i64,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Clear is_selected on other sessions in the same collection
    sqlx::query("UPDATE replayer_sessions SET is_selected = 0 WHERE collection_id = ?")
        .bind(&collection_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Ensure parent collection is expanded and selected
    sqlx::query("UPDATE replayer_collections SET is_expanded = 1, is_selected = 1 WHERE id = ?")
        .bind(&collection_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO replayer_sessions (id, collection_id, name, base_url, request_tmp, sort_order, is_selected) VALUES (?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&session_id)
    .bind(&collection_id)
    .bind(&name)
    .bind(&base_url)
    .bind(&request_tmp)
    .bind(sort_order)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rename_replayer_session(
    db: tauri::State<'_, DbState>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query("UPDATE replayer_sessions SET name = ? WHERE id = ?")
        .bind(&name)
        .bind(&session_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_replayer_session_draft(
    db: tauri::State<'_, DbState>,
    session_id: String,
    request_tmp: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    if let Some(req) = request_tmp {
        sqlx::query("UPDATE replayer_sessions SET request_tmp = ? WHERE id = ?")
            .bind(&req)
            .bind(&session_id)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(url) = base_url {
        sqlx::query("UPDATE replayer_sessions SET base_url = ? WHERE id = ?")
            .bind(&url)
            .bind(&session_id)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_replayer_session(
    db: tauri::State<'_, DbState>,
    session_id: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query("DELETE FROM replayer_sessions WHERE id = ?")
        .bind(&session_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_replayer_history_entry(
    db: tauri::State<'_, DbState>,
    session_id: String,
    history_id: String,
    request_raw: String,
    response_raw: String,
    response_time: i64,
    created_at: String,
    status: Option<String>,
    error_message: Option<String>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query(
        "INSERT INTO replayer_history (id, session_id, request_raw, response_raw, response_time, created_at, sort_order, status, error_message) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&history_id)
    .bind(&session_id)
    .bind(&request_raw)
    .bind(&response_raw)
    .bind(response_time)
    .bind(&created_at)
    .bind(status.unwrap_or_default())
    .bind(error_message)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
