use crate::ares_utils::database::DbState;
use serde::{Deserialize, Serialize};
use sqlx::types::chrono;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbSitemapStateRow {
    pub project_id: String,
    pub selected_node_id: Option<String>,
    pub selected_request_id: Option<i64>,
    pub expanded_ids: String, // JSON array string
    pub search_term: String,
    pub scope_filter: String,
    pub req_view_mode: String,
    pub res_view_mode: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SitemapStateData {
    pub project_id: String,
    pub selected_node_id: Option<String>,
    pub selected_request_id: Option<i64>,
    pub expanded_ids: Vec<String>,
    pub search_term: String,
    pub scope_filter: String,
    pub req_view_mode: String,
    pub res_view_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSitemapStateInput {
    pub selected_node_id: Option<String>,
    pub selected_request_id: Option<i64>,
    pub expanded_ids: Vec<String>,
    pub search_term: Option<String>,
    pub scope_filter: Option<String>,
    pub req_view_mode: Option<String>,
    pub res_view_mode: Option<String>,
}

#[tauri::command]
pub async fn get_sitemap_state_db(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Option<SitemapStateData>, String> {
    let pool = db.pool().await?;
    let row: Option<DbSitemapStateRow> = sqlx::query_as(
        "SELECT project_id, selected_node_id, selected_request_id, expanded_ids, search_term, scope_filter, req_view_mode, res_view_mode, updated_at FROM sitemap_state WHERE project_id = ?"
    )
    .bind(&project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(r) = row {
        let expanded_ids: Vec<String> = serde_json::from_str(&r.expanded_ids).unwrap_or_default();
        Ok(Some(SitemapStateData {
            project_id: r.project_id,
            selected_node_id: r.selected_node_id,
            selected_request_id: r.selected_request_id,
            expanded_ids,
            search_term: r.search_term,
            scope_filter: r.scope_filter,
            req_view_mode: r.req_view_mode,
            res_view_mode: r.res_view_mode,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn save_sitemap_state_db(
    db: State<'_, DbState>,
    project_id: String,
    state: SaveSitemapStateInput,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();
    let expanded_ids_json = serde_json::to_string(&state.expanded_ids).unwrap_or_else(|_| "[]".to_string());
    let search_term = state.search_term.unwrap_or_default();
    let scope_filter = state.scope_filter.unwrap_or_else(|| "all".to_string());
    let req_view_mode = state.req_view_mode.unwrap_or_else(|| "raw".to_string());
    let res_view_mode = state.res_view_mode.unwrap_or_else(|| "raw".to_string());

    sqlx::query(
        "INSERT INTO sitemap_state (project_id, selected_node_id, selected_request_id, expanded_ids, search_term, scope_filter, req_view_mode, res_view_mode, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(project_id) DO UPDATE SET \
            selected_node_id = excluded.selected_node_id, \
            selected_request_id = excluded.selected_request_id, \
            expanded_ids = excluded.expanded_ids, \
            search_term = excluded.search_term, \
            scope_filter = excluded.scope_filter, \
            req_view_mode = excluded.req_view_mode, \
            res_view_mode = excluded.res_view_mode, \
            updated_at = excluded.updated_at"
    )
    .bind(&project_id)
    .bind(&state.selected_node_id)
    .bind(state.selected_request_id)
    .bind(&expanded_ids_json)
    .bind(&search_term)
    .bind(&scope_filter)
    .bind(&req_view_mode)
    .bind(&res_view_mode)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
