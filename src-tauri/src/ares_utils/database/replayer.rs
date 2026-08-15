use crate::ares_utils::database::DbState;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

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
    pub base_url: Option<String>,
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

#[derive(Debug, Clone, FromRow)]
pub struct ReplayerFullJoinedRow {
    pub col_id: String,
    pub col_name: String,
    pub col_is_expanded: i64,
    pub col_is_selected: i64,

    pub sess_id: Option<String>,
    pub sess_name: Option<String>,
    pub sess_base_url: Option<String>,
    pub sess_request_tmp: Option<String>,
    pub sess_is_selected: Option<i64>,
    pub sess_selected_history_index: Option<i64>,

    pub hist_id: Option<String>,
    pub hist_request_raw: Option<String>,
    pub hist_response_raw: Option<String>,
    pub hist_response_time: Option<i64>,
    pub hist_created_at: Option<String>,
    pub hist_status: Option<String>,
    pub hist_error_message: Option<String>,
    pub hist_base_url: Option<String>,
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

    // Single unified SQL query joining collections, sessions, and history
    let rows = sqlx::query_as::<_, ReplayerFullJoinedRow>(
        r#"
        SELECT 
            c.id AS col_id,
            c.name AS col_name,
            c.is_expanded AS col_is_expanded,
            c.is_selected AS col_is_selected,
            
            s.id AS sess_id,
            s.name AS sess_name,
            s.base_url AS sess_base_url,
            s.request_tmp AS sess_request_tmp,
            s.is_selected AS sess_is_selected,
            s.selected_history_index AS sess_selected_history_index,
            
            h.id AS hist_id,
            h.request_raw AS hist_request_raw,
            h.response_raw AS hist_response_raw,
            h.response_time AS hist_response_time,
            h.created_at AS hist_created_at,
            h.status AS hist_status,
            h.error_message AS hist_error_message,
            h.base_url AS hist_base_url
        FROM replayer_collections c
        LEFT JOIN replayer_sessions s ON s.collection_id = c.id
        LEFT JOIN replayer_history h ON h.session_id = s.id
        WHERE c.project_id = ?
        ORDER BY c.sort_order ASC, c.rowid ASC, s.sort_order ASC, s.rowid ASC, h.sort_order ASC, h.rowid DESC
        "#,
    )
    .bind(&project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() {
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

    let mut full_collections: Vec<ReplayerCollectionFull> = Vec::new();
    let mut selected_collection_idx = 0;
    let mut expanded_ids = Vec::new();

    let mut col_index_map: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut sess_index_map: std::collections::HashMap<String, (usize, usize)> =
        std::collections::HashMap::new();

    for row in rows {
        let col_idx = match col_index_map.get(&row.col_id) {
            Some(&idx) => idx,
            None => {
                let idx = full_collections.len();
                if row.col_is_selected == 1 {
                    selected_collection_idx = idx;
                }
                if row.col_is_expanded != 0 {
                    expanded_ids.push(row.col_id.clone());
                }
                full_collections.push(ReplayerCollectionFull {
                    id: row.col_id.clone(),
                    name: row.col_name,
                    is_expanded: row.col_is_expanded != 0,
                    sessions: Vec::new(),
                    selected_session_index: None,
                });
                col_index_map.insert(row.col_id.clone(), idx);
                idx
            }
        };

        if let Some(sess_id) = row.sess_id {
            let (c_idx, s_idx) = match sess_index_map.get(&sess_id) {
                Some(&(c_i, s_i)) => (c_i, s_i),
                None => {
                    let s_i = full_collections[col_idx].sessions.len();
                    if row.sess_is_selected == Some(1)
                        && full_collections[col_idx].selected_session_index.is_none()
                    {
                        full_collections[col_idx].selected_session_index = Some(s_i);
                    }
                    let base_url = row.sess_base_url.unwrap_or_default();
                    let url_is_valid = !base_url.is_empty() && base_url != "https://";

                    full_collections[col_idx]
                        .sessions
                        .push(ReplayerSessionFull {
                            id: sess_id.clone(),
                            name: row.sess_name.unwrap_or_else(|| "Session".to_string()),
                            url: base_url,
                            request_tmp: row.sess_request_tmp.unwrap_or_default(),
                            history: Vec::new(),
                            selected_history_index: None,
                            url_is_valid,
                        });
                    sess_index_map.insert(sess_id.clone(), (col_idx, s_i));
                    (col_idx, s_i)
                }
            };

            if let Some(hist_id) = row.hist_id {
                let mut status = row.hist_status.unwrap_or_default();
                let resp_raw = row.hist_response_raw.unwrap_or_default();
                let err_msg = row.hist_error_message;

                if status.is_empty() {
                    if err_msg.is_some() {
                        status = "Error".to_string();
                    } else if let Some(first_line) = resp_raw.lines().next() {
                        if let Some(code) = first_line.split_whitespace().nth(1) {
                            if code.chars().all(|c| c.is_ascii_digit()) {
                                status = code.to_string();
                            }
                        }
                    }
                }

                let sess_url = &full_collections[c_idx].sessions[s_idx].url;
                let base_url = row.hist_base_url.or_else(|| {
                    if sess_url.is_empty() {
                        None
                    } else {
                        Some(sess_url.clone())
                    }
                });

                full_collections[c_idx].sessions[s_idx]
                    .history
                    .push(ReplayerHistoryItemFull {
                        id: hist_id,
                        request_raw: row.hist_request_raw.unwrap_or_default(),
                        response_raw: resp_raw,
                        response_time: row.hist_response_time.unwrap_or(0),
                        created_at: row.hist_created_at.unwrap_or_default(),
                        status,
                        error_message: err_msg,
                        base_url,
                    });
            }

            if let Some(hist_idx) = row.sess_selected_history_index {
                let hist_len = full_collections[c_idx].sessions[s_idx].history.len();
                if (hist_idx as usize) < hist_len {
                    full_collections[c_idx].sessions[s_idx].selected_history_index =
                        Some(hist_idx as usize);
                }
            }
        }
    }

    for col in &mut full_collections {
        for sess in &mut col.sessions {
            if sess.selected_history_index.is_none() && !sess.history.is_empty() {
                sess.selected_history_index = Some(0);
            }
        }
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
        sqlx::query(
            "UPDATE replayer_collections SET is_expanded = 1 WHERE id = ? AND project_id = ?",
        )
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
    selected_history_index: Option<i64>,
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
    if let Some(idx) = selected_history_index {
        sqlx::query("UPDATE replayer_sessions SET selected_history_index = ? WHERE id = ?")
            .bind(idx)
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
    base_url: Option<String>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query(
        "INSERT INTO replayer_history (id, session_id, request_raw, response_raw, response_time, created_at, sort_order, status, error_message, base_url) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&history_id)
    .bind(&session_id)
    .bind(&request_raw)
    .bind(&response_raw)
    .bind(response_time)
    .bind(&created_at)
    .bind(status.unwrap_or_default())
    .bind(error_message)
    .bind(base_url)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
