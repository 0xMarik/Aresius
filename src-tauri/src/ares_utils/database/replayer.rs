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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerHistoryItemFull {
    pub id: String,
    pub request_raw: String,
    pub response_raw: String,
    pub response_time: i64,
    pub created_at: String,
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
    pub sessions: Vec<ReplayerSessionFull>,
    pub selected_session_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerFullData {
    pub collections: Vec<ReplayerCollectionFull>,
    pub selected_collection_index: usize,
}

#[tauri::command]
pub async fn get_replayer_data(
    db: tauri::State<'_, DbState>,
    project_id: String,
) -> Result<ReplayerFullData, String> {
    let pool = db.pool().await?;

    let collections = sqlx::query_as::<_, ReplayerCollectionRow>(
        "SELECT id, project_id, name, sort_order FROM replayer_collections WHERE project_id = ? ORDER BY sort_order ASC, rowid ASC",
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
            "INSERT INTO replayer_collections (id, project_id, name, sort_order) VALUES (?, ?, ?, 0)",
        )
        .bind(&col_id)
        .bind(&project_id)
        .bind("Default Collection")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT INTO replayer_sessions (id, collection_id, name, base_url, request_tmp, sort_order) VALUES (?, ?, ?, ?, ?, 0)",
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
                id: col_id,
                name: "Default Collection".to_string(),
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
        });
    }

    let mut full_collections = Vec::new();

    for col_row in collections {
        let sessions = sqlx::query_as::<_, ReplayerSessionRow>(
            "SELECT id, collection_id, name, base_url, request_tmp, sort_order FROM replayer_sessions WHERE collection_id = ? ORDER BY sort_order ASC, rowid ASC",
        )
        .bind(&col_row.id)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut full_sessions = Vec::new();

        for sess_row in sessions {
            let histories = sqlx::query_as::<_, ReplayerHistoryRow>(
                "SELECT id, session_id, request_raw, response_raw, response_time, created_at, sort_order FROM replayer_history WHERE session_id = ? ORDER BY sort_order ASC, rowid DESC",
            )
            .bind(&sess_row.id)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

            let full_histories: Vec<ReplayerHistoryItemFull> = histories
                .into_iter()
                .map(|h| ReplayerHistoryItemFull {
                    id: h.id,
                    request_raw: h.request_raw,
                    response_raw: h.response_raw,
                    response_time: h.response_time,
                    created_at: h.created_at,
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

        full_collections.push(ReplayerCollectionFull {
            id: col_row.id,
            name: col_row.name,
            sessions: full_sessions,
            selected_session_index: if has_sessions { Some(0) } else { None },
        });
    }

    Ok(ReplayerFullData {
        collections: full_collections,
        selected_collection_index: 0,
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
    sqlx::query(
        "INSERT INTO replayer_collections (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)",
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
    sqlx::query(
        "INSERT INTO replayer_sessions (id, collection_id, name, base_url, request_tmp, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&session_id)
    .bind(&collection_id)
    .bind(&name)
    .bind(&base_url)
    .bind(&request_tmp)
    .bind(sort_order)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query(
        "INSERT INTO replayer_history (id, session_id, request_raw, response_raw, response_time, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(&history_id)
    .bind(&session_id)
    .bind(&request_raw)
    .bind(&response_raw)
    .bind(response_time)
    .bind(&created_at)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
