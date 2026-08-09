use sqlx::SqlitePool;

use crate::ares_utils::database::DbState;

/// Mirrors the `http_history` table row exactly as returned by SELECT *.
/// `id` is the auto-incremented rowid assigned by SQLite on insert.
#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpHistoryRow {
    pub id: i64,
    pub project_id: String,
    pub host: String,
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub extension: Option<String>,
    pub status_code: i64,
    pub response_length: i64,
    pub response_time_ms: i64,
    pub sent_at_ms: i64,
    pub state: String,
    pub is_https: bool,
    pub raw_request: String,
    pub raw_response: String,
}

/// Derives the `state` label from a raw HTTP status code, matching the
/// logic in the frontend's `stateFromCode` helper.
pub fn state_from_code(code: u16) -> &'static str {
    if code == 0 {
        return "Pending";
    }
    match code {
        100..=199 => "Info",
        200..=299 => "Success",
        300..=399 => "Redirect",
        400..=499 => "Client Error",
        500..=599 => "Server Error",
        _ => "Failed",
    }
}

/// Persists a single captured HTTP transaction to the project database.
/// This is intentionally fire-and-forget: callers should `tokio::spawn` it
/// so the proxy path is never blocked by a slow disk write.
pub async fn save_http_history(
    pool: SqlitePool,
    project_id: String,
    host: String,
    method: String,
    path: String,
    query: Option<String>,
    extension: Option<String>,
    status_code: u16,
    response_length: usize,
    response_time_ms: u64,
    sent_at_ms: u128,
    is_https: bool,
    raw_request: String,
    raw_response: String,
) -> Result<(), String> {
    let state = state_from_code(status_code);

    sqlx::query(
        "INSERT INTO http_history
            (project_id, host, method, path, query, extension,
             status_code, response_length, response_time_ms,
             sent_at_ms, state, is_https, raw_request, raw_response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&project_id)
    .bind(&host)
    .bind(&method)
    .bind(&path)
    .bind(&query)
    .bind(&extension)
    .bind(status_code as i64)
    .bind(response_length as i64)
    .bind(response_time_ms as i64)
    .bind(sent_at_ms as i64)
    .bind(state)
    .bind(is_https)
    .bind(&raw_request)
    .bind(&raw_response)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Tauri command: returns all HTTP history rows for the active project,
/// ordered chronologically. Called once when a project is opened so the
/// frontend can pre-populate its Redux store from persisted data.
#[tauri::command]
pub async fn get_http_history(db: tauri::State<'_, DbState>) -> Result<Vec<HttpHistoryRow>, String> {
    let pool = db.pool().await?;

    sqlx::query_as::<_, HttpHistoryRow>(
        "SELECT * FROM http_history ORDER BY sent_at_ms ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}
