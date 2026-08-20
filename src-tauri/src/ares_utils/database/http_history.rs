use sqlx::SqlitePool;

use crate::{ares_utils::database::DbState, proxy::utils::HistoryIdCounter};

/// Mirrors the `http_history` table row exactly as returned by SELECT *.
/// `id` is the auto-incremented rowid assigned by SQLite on insert.
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpHistoryRow {
    pub id: u32,
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
    pub request_auto_patch: Option<String>,
    pub request_manual_patch: Option<String>,
    pub response_auto_patch: Option<String>,
    pub response_manual_patch: Option<String>,
    pub request_edit_type: Option<String>,
    pub response_edit_type: Option<String>,
}

/// Lightweight summary row for table views and sitemap tree building.
/// Excludes large rawRequest and rawResponse text fields.
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpHistorySummaryRowDb {
    pub id: u32,
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
    pub request_auto_patch: Option<String>,
    pub request_manual_patch: Option<String>,
    pub response_auto_patch: Option<String>,
    pub response_manual_patch: Option<String>,
    pub request_edit_type: Option<String>,
    pub response_edit_type: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpHistoryWindowResult {
    pub total: usize,
    pub items: Vec<HttpHistorySummaryRowDb>,
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
    request_auto_patch: Option<String>,
    request_manual_patch: Option<String>,
    response_auto_patch: Option<String>,
    response_manual_patch: Option<String>,
    request_edit_type: Option<String>,
    response_edit_type: Option<String>,
) -> Result<(), String> {
    let state = state_from_code(status_code);

    sqlx::query(
        "INSERT INTO http_history
            (project_id, host, method, path, query, extension,
             status_code, response_length, response_time_ms,
             sent_at_ms, state, is_https, raw_request, raw_response,
             request_auto_patch, request_manual_patch,
             response_auto_patch, response_manual_patch,
             request_edit_type, response_edit_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    .bind(&request_auto_patch)
    .bind(&request_manual_patch)
    .bind(&response_auto_patch)
    .bind(&response_manual_patch)
    .bind(&request_edit_type)
    .bind(&response_edit_type)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Legacy bulk fetch kept for compatibility
#[tauri::command]
pub async fn get_http_history(
    db: tauri::State<'_, DbState>,
    history_counter: tauri::State<'_, HistoryIdCounter>,
) -> Result<Vec<HttpHistoryRow>, String> {
    let pool = db.pool().await?;

    let rows = sqlx::query_as::<_, HttpHistoryRow>("SELECT * FROM http_history ORDER BY id ASC")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let next_id = rows.iter().map(|r| r.id).max().map(|m| m + 1).unwrap_or(0);
    history_counter.set_next(next_id);

    Ok(rows)
}

/// Returns lightweight summary rows for constructing sitemap trees without heavy raw payloads
#[tauri::command]
pub async fn get_http_history_summaries(
    db: tauri::State<'_, DbState>,
    project_id: Option<String>,
) -> Result<Vec<HttpHistorySummaryRowDb>, String> {
    let pool = db.pool().await?;

    let rows = if let Some(pid) = project_id {
        sqlx::query_as::<_, HttpHistorySummaryRowDb>(
            "SELECT id, project_id, host, method, path, query, extension, status_code, response_length, response_time_ms, sent_at_ms, state, is_https, request_auto_patch, request_manual_patch, response_auto_patch, response_manual_patch, request_edit_type, response_edit_type
             FROM http_history
             WHERE project_id = ?
             ORDER BY id ASC",
        )
        .bind(pid)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query_as::<_, HttpHistorySummaryRowDb>(
            "SELECT id, project_id, host, method, path, query, extension, status_code, response_length, response_time_ms, sent_at_ms, state, is_https, request_auto_patch, request_manual_patch, response_auto_patch, response_manual_patch, request_edit_type, response_edit_type
             FROM http_history
             ORDER BY id ASC",
        )
        .fetch_all(&pool)
        .await
    }
    .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Fetches a window of summary rows with server-side sorting, filtering, and paging
#[tauri::command]
pub async fn get_http_history_window(
    db: tauri::State<'_, DbState>,
    project_id: Option<String>,
    offset: usize,
    limit: usize,
    sort_by: Option<String>,
    sort_order: Option<String>,
    search: Option<String>,
    scope: Option<crate::proxy::interceptor::ActiveScope>,
    scope_filter: Option<String>,
) -> Result<HttpHistoryWindowResult, String> {
    let pool = db.pool().await?;

    let is_desc = sort_order
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("desc"))
        .unwrap_or(false);
    let dir = if is_desc { "DESC" } else { "ASC" };

    let order_clause = match sort_by.as_deref() {
        Some("id") => format!("id {}", dir),
        Some("method") => format!("method {} NULLS LAST, id ASC", dir),
        Some("host") => format!("host {} NULLS LAST, id ASC", dir),
        Some("path") => format!("path {} NULLS LAST, id ASC", dir),
        Some("query") => format!("query {} NULLS LAST, id ASC", dir),
        Some("extension") | Some("ext") => format!("extension {} NULLS LAST, id ASC", dir),
        Some("statusCode") | Some("status_code") | Some("status") => {
            format!("status_code {} NULLS LAST, id ASC", dir)
        }
        Some("responseLength") | Some("response_length") | Some("length") => {
            format!("response_length {} NULLS LAST, id ASC", dir)
        }
        Some("responseTimeMs") | Some("response_time_ms") | Some("duration") => {
            format!("response_time_ms {} NULLS LAST, id ASC", dir)
        }
        Some("sentAtMs") | Some("sent_at_ms") | Some("sentAt") => {
            format!("sent_at_ms {} NULLS LAST, id ASC", dir)
        }
        Some("state") => format!("state {} NULLS LAST, id ASC", dir),
        _ => "id ASC".to_string(),
    };

    let filter_mode = scope_filter.as_deref().unwrap_or("all");
    let needs_scope_filter = scope.is_some() && (filter_mode == "in" || filter_mode == "out");

    let mut query_builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT id, project_id, host, method, path, query, extension, status_code, response_length, response_time_ms, sent_at_ms, state, is_https, request_auto_patch, request_manual_patch, response_auto_patch, response_manual_patch, request_edit_type, response_edit_type FROM http_history WHERE 1=1"
    );
    if let Some(ref pid) = project_id {
        query_builder.push(" AND project_id = ");
        query_builder.push_bind(pid);
    }
    if let Some(ref q) = search {
        if !q.trim().is_empty() {
            let pattern = format!("%{}%", q.trim());
            query_builder.push(" AND (host LIKE ");
            query_builder.push_bind(pattern.clone());
            query_builder.push(" OR path LIKE ");
            query_builder.push_bind(pattern.clone());
            query_builder.push(" OR method LIKE ");
            query_builder.push_bind(pattern.clone());
            query_builder.push(" OR query LIKE ");
            query_builder.push_bind(pattern.clone());
            query_builder.push(" OR CAST(status_code AS TEXT) LIKE ");
            query_builder.push_bind(pattern);
            query_builder.push(")");
        }
    }
    query_builder.push(" ORDER BY ");
    query_builder.push(&order_clause);

    if needs_scope_filter {
        let active_scope = scope.as_ref().unwrap();
        let compiled_scope = crate::proxy::interceptor::CompiledScope::compile(active_scope);
        let match_in = filter_mode == "in";

        let all_rows = query_builder
            .build_query_as::<HttpHistorySummaryRowDb>()
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let filtered: Vec<HttpHistorySummaryRowDb> = all_rows
            .into_iter()
            .filter(|row| {
                compiled_scope.is_in_scope(&row.host, &row.path) == match_in
            })
            .collect();

        let total = filtered.len();
        let window_items = filtered
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect();

        return Ok(HttpHistoryWindowResult {
            total,
            items: window_items,
        });
    }

    // 1. Compute total matching rows when not filtering by scope in memory
    let mut count_builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT COUNT(*) FROM http_history WHERE 1=1");
    if let Some(ref pid) = project_id {
        count_builder.push(" AND project_id = ");
        count_builder.push_bind(pid);
    }
    if let Some(ref q) = search {
        if !q.trim().is_empty() {
            let pattern = format!("%{}%", q.trim());
            count_builder.push(" AND (host LIKE ");
            count_builder.push_bind(pattern.clone());
            count_builder.push(" OR path LIKE ");
            count_builder.push_bind(pattern.clone());
            count_builder.push(" OR method LIKE ");
            count_builder.push_bind(pattern.clone());
            count_builder.push(" OR query LIKE ");
            count_builder.push_bind(pattern.clone());
            count_builder.push(" OR CAST(status_code AS TEXT) LIKE ");
            count_builder.push_bind(pattern);
            count_builder.push(")");
        }
    }

    let total: i64 = count_builder
        .build_query_scalar::<i64>()
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

    query_builder.push(" LIMIT ");
    query_builder.push_bind(limit as i64);
    query_builder.push(" OFFSET ");
    query_builder.push_bind(offset as i64);

    let items = query_builder
        .build_query_as::<HttpHistorySummaryRowDb>()
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(HttpHistoryWindowResult {
        total: total as usize,
        items,
    })
}

/// Fetches full request and response payload for a single HTTP history item by ID
#[tauri::command]
pub async fn get_http_history_item(
    db: tauri::State<'_, DbState>,
    id: u32,
) -> Result<Option<HttpHistoryRow>, String> {
    let pool = db.pool().await?;

    let row = sqlx::query_as::<_, HttpHistoryRow>("SELECT * FROM http_history WHERE id = ? LIMIT 1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row)
}

/// Deletes specific HTTP history items by IDs
#[tauri::command]
pub async fn delete_http_history_items(
    db: tauri::State<'_, DbState>,
    ids: Vec<u32>,
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }

    let pool = db.pool().await?;
    let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new("DELETE FROM http_history WHERE id IN (");
    let mut separated = builder.separated(", ");
    for id in ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");

    builder
        .build()
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
