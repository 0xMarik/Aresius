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

impl crate::ares_utils::httpql::HttpTransactionEvaluable for HttpHistorySummaryRowDb {
    fn eval_id(&self) -> u32 {
        self.id
    }
    fn eval_method(&self) -> &str {
        &self.method
    }
    fn eval_host(&self) -> &str {
        &self.host
    }
    fn eval_path(&self) -> &str {
        &self.path
    }
    fn eval_query(&self) -> Option<&str> {
        self.query.as_deref()
    }
    fn eval_ext(&self) -> Option<&str> {
        self.extension.as_deref()
    }
    fn eval_status_code(&self) -> i64 {
        self.status_code
    }
    fn eval_response_length(&self) -> i64 {
        self.response_length
    }
    fn eval_response_time_ms(&self) -> i64 {
        self.response_time_ms
    }
    fn eval_sent_at_ms(&self) -> i64 {
        self.sent_at_ms
    }
    fn eval_state(&self) -> &str {
        &self.state
    }
    fn eval_is_https(&self) -> bool {
        self.is_https
    }
    fn eval_raw_request(&self) -> Option<&str> {
        None
    }
    fn eval_raw_response(&self) -> Option<&str> {
        None
    }
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
    apply_interception_filters: Option<bool>,
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

    // 1. Fetch presets map for this project
    let mut preset_map = std::collections::HashMap::new();
    let mut interception_exprs = Vec::new();
    if let Some(ref pid) = project_id {
        if let Ok(rows) = sqlx::query_as::<_, crate::ares_utils::database::preset_filters::DbPresetFilterRow>(
            "SELECT id, project_id, name, alias, expression, description, badge, apply_in_interception, sort_order, created_at, updated_at FROM preset_filters WHERE project_id = ?"
        )
        .bind(pid)
        .fetch_all(&pool)
        .await {
            for r in &rows {
                preset_map.insert(r.alias.to_lowercase(), r.expression.clone());
            }

            if apply_interception_filters.unwrap_or(false) {
                for r in rows {
                    if r.apply_in_interception {
                        if let Ok(Some(expr)) = crate::ares_utils::httpql::parse_httpql_with_presets(&r.expression, &preset_map) {
                            interception_exprs.push(expr);
                        }
                    }
                }
            }
        }
    }

    let mut query_builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT id, project_id, host, method, path, query, extension, status_code, response_length, response_time_ms, sent_at_ms, state, is_https, request_auto_patch, request_manual_patch, response_auto_patch, response_manual_patch, request_edit_type, response_edit_type FROM http_history WHERE 1=1"
    );
    if let Some(ref pid) = project_id {
        query_builder.push(" AND project_id = ");
        query_builder.push_bind(pid);
    }

    let parsed_httpql = if let Some(ref q) = search {
        if !q.trim().is_empty() {
            match crate::ares_utils::httpql::parse_httpql_with_presets(q, &preset_map) {
                Ok(Some(expr)) => Some(expr),
                _ => {
                    // Fallback to a single bare expression
                    Some(crate::ares_utils::httpql::HttpqlExpr::Bare(q.trim().to_string()))
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    let final_httpql = match (parsed_httpql, interception_exprs.is_empty()) {
        (Some(user_expr), true) => Some(user_expr),
        (None, false) => {
            if interception_exprs.len() == 1 {
                Some(interception_exprs.remove(0))
            } else {
                Some(crate::ares_utils::httpql::HttpqlExpr::And(interception_exprs))
            }
        }
        (Some(user_expr), false) => {
            let mut all = interception_exprs;
            all.push(user_expr);
            Some(crate::ares_utils::httpql::HttpqlExpr::And(all))
        }
        (None, true) => None,
    };

    if let Some(ref expr) = final_httpql {
        query_builder.push(" AND ");
        crate::ares_utils::httpql::compile_httpql_to_sql(&mut query_builder, expr);
    }
    query_builder.push(" ORDER BY ");
    query_builder.push(&order_clause);

    let has_regex = final_httpql.as_ref().map_or(false, |e| e.has_regex());
    let needs_memory_filter = needs_scope_filter || has_regex;

    if needs_memory_filter {
        let compiled_scope = scope.as_ref().map(crate::proxy::interceptor::CompiledScope::compile);
        let match_in = filter_mode == "in";

        let all_rows = query_builder
            .build_query_as::<HttpHistorySummaryRowDb>()
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let filtered: Vec<HttpHistorySummaryRowDb> = all_rows
            .into_iter()
            .filter(|row| {
                if let Some(ref sc) = compiled_scope {
                    let in_scope = sc.is_in_scope(&row.host, &row.path);
                    if in_scope != match_in {
                        return false;
                    }
                }
                if let Some(ref expr) = final_httpql {
                    if has_regex && !expr.evaluate(row) {
                        return false;
                    }
                }
                true
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

    // 1. Compute total matching rows when not filtering by scope/regex in memory
    let mut count_builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT COUNT(*) FROM http_history WHERE 1=1");
    if let Some(ref pid) = project_id {
        count_builder.push(" AND project_id = ");
        count_builder.push_bind(pid);
    }
    if let Some(ref expr) = final_httpql {
        count_builder.push(" AND ");
        crate::ares_utils::httpql::compile_httpql_to_sql(&mut count_builder, expr);
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpqlValidationResult {
    pub is_valid: bool,
    pub error: Option<String>,
}

/// Validates an HTTPQL query string and returns syntax correctness
#[tauri::command]
pub fn validate_httpql(query: String) -> HttpqlValidationResult {
    if query.trim().is_empty() {
        return HttpqlValidationResult {
            is_valid: true,
            error: None,
        };
    }
    match crate::ares_utils::httpql::parse_httpql(&query) {
        Ok(_) => HttpqlValidationResult {
            is_valid: true,
            error: None,
        },
        Err(err) => HttpqlValidationResult {
            is_valid: false,
            error: Some(err),
        },
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpqlSandboxTransaction {
    pub id: Option<u32>,
    pub method: Option<String>,
    pub host: Option<String>,
    pub path: Option<String>,
    pub query: Option<String>,
    pub extension: Option<String>,
    pub status_code: Option<i64>,
    pub response_length: Option<i64>,
    pub response_time_ms: Option<i64>,
    pub sent_at_ms: Option<i64>,
    pub state: Option<String>,
    pub is_https: Option<bool>,
    pub raw_request: Option<String>,
    pub raw_response: Option<String>,
}

impl crate::ares_utils::httpql::HttpTransactionEvaluable for HttpqlSandboxTransaction {
    fn eval_id(&self) -> u32 {
        self.id.unwrap_or(1)
    }
    fn eval_method(&self) -> &str {
        self.method.as_deref().unwrap_or("GET")
    }
    fn eval_host(&self) -> &str {
        self.host.as_deref().unwrap_or("example.com")
    }
    fn eval_path(&self) -> &str {
        self.path.as_deref().unwrap_or("/")
    }
    fn eval_query(&self) -> Option<&str> {
        self.query.as_deref()
    }
    fn eval_ext(&self) -> Option<&str> {
        self.extension.as_deref()
    }
    fn eval_status_code(&self) -> i64 {
        self.status_code.unwrap_or(200)
    }
    fn eval_response_length(&self) -> i64 {
        self.response_length.unwrap_or(0)
    }
    fn eval_response_time_ms(&self) -> i64 {
        self.response_time_ms.unwrap_or(50)
    }
    fn eval_sent_at_ms(&self) -> i64 {
        self.sent_at_ms.unwrap_or_else(|| chrono::Utc::now().timestamp_millis() as i64)
    }
    fn eval_state(&self) -> &str {
        self.state.as_deref().unwrap_or("Success")
    }
    fn eval_is_https(&self) -> bool {
        self.is_https.unwrap_or(false)
    }
    fn eval_raw_request(&self) -> Option<&str> {
        self.raw_request.as_deref()
    }
    fn eval_raw_response(&self) -> Option<&str> {
        self.raw_response.as_deref()
    }
}

/// Evaluates an HTTPQL query against a test transaction in memory using the real HTTPQL engine
#[tauri::command]
pub async fn evaluate_httpql_sandbox(
    db: tauri::State<'_, DbState>,
    query: String,
    project_id: Option<String>,
    test_transaction: HttpqlSandboxTransaction,
) -> Result<bool, String> {
    if query.trim().is_empty() {
        return Ok(true);
    }

    let mut preset_map = std::collections::HashMap::new();
    if let Some(ref pid) = project_id {
        if let Ok(pool) = db.pool().await {
            if let Ok(rows) = sqlx::query_as::<_, crate::ares_utils::database::preset_filters::DbPresetFilterRow>(
                "SELECT id, project_id, name, alias, expression, description, badge, apply_in_interception, sort_order, created_at, updated_at FROM preset_filters WHERE project_id = ?"
            )
            .bind(pid)
            .fetch_all(&pool)
            .await {
                for r in rows {
                    preset_map.insert(r.alias.to_lowercase(), r.expression);
                }
            }
        }
    }

    let expr = crate::ares_utils::httpql::parse_httpql_with_presets(&query, &preset_map)
        .map_err(|e| format!("HTTPQL Syntax Error: {e}"))?;

    match expr {
        Some(e) => Ok(e.evaluate(&test_transaction)),
        None => Ok(true),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbHttpHistoryStateRow {
    pub project_id: String,
    pub httpql_query: String,
    pub scope_filter: String,
    pub selected_request_id: Option<i64>,
    pub apply_interception_filters: bool,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn get_http_history_state_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
) -> Result<Option<DbHttpHistoryStateRow>, String> {
    let pool = db.pool().await?;
    let row: Option<DbHttpHistoryStateRow> = sqlx::query_as(
        "SELECT project_id, httpql_query, scope_filter, selected_request_id, apply_interception_filters, updated_at FROM http_history_state WHERE project_id = ?"
    )
    .bind(&project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row)
}

#[tauri::command]
pub async fn save_http_history_state_db(
    db: tauri::State<'_, DbState>,
    project_id: String,
    httpql_query: String,
    scope_filter: Option<String>,
    selected_request_id: Option<i64>,
    apply_interception_filters: Option<bool>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let scope = scope_filter.unwrap_or_else(|| "in".to_string());
    let apply_filters = apply_interception_filters.unwrap_or(true);

    sqlx::query(
        "INSERT INTO http_history_state (project_id, httpql_query, scope_filter, selected_request_id, apply_interception_filters, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
            httpql_query = excluded.httpql_query,
            scope_filter = excluded.scope_filter,
            selected_request_id = excluded.selected_request_id,
            apply_interception_filters = excluded.apply_interception_filters,
            updated_at = excluded.updated_at"
    )
    .bind(&project_id)
    .bind(&httpql_query)
    .bind(&scope)
    .bind(selected_request_id)
    .bind(apply_filters)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}



