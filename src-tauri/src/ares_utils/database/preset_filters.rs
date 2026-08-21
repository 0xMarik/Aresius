use crate::ares_utils::database::DbState;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbPresetFilterRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub alias: String,
    pub expression: String,
    pub description: String,
    pub badge: String,
    pub apply_in_interception: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetFilterItem {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub alias: String,
    pub expression: String,
    pub description: String,
    pub badge: String,
    pub apply_in_interception: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn get_default_presets(project_id: &str) -> Vec<PresetFilterItem> {
    let now = now_ms();
    vec![
        PresetFilterItem {
            id: format!("def-{}-hide-static", project_id),
            project_id: project_id.to_string(),
            name: "Hide Static".to_string(),
            alias: "hide-static".to_string(),
            expression: "req.ext.ncont:['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ico', '.ttf', '.map', '.webp', '.avif', '.mp4', '.mp3', '.wasm']".to_string(),
            description: "Hide static assets (images, CSS, JS, fonts, maps)".to_string(),
            badge: "Noise".to_string(),
            apply_in_interception: false,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
        PresetFilterItem {
            id: format!("def-{}-errors-only", project_id),
            project_id: project_id.to_string(),
            name: "4xx / 5xx Errors".to_string(),
            alias: "errors-only".to_string(),
            expression: "resp.code.gte:400".to_string(),
            description: "Filter for client and server error responses".to_string(),
            badge: "Errors".to_string(),
            apply_in_interception: false,
            sort_order: 1,
            created_at: now,
            updated_at: now,
        },
        PresetFilterItem {
            id: format!("def-{}-success-only", project_id),
            project_id: project_id.to_string(),
            name: "2xx Success".to_string(),
            alias: "success-only".to_string(),
            expression: "resp.code.gte:200 and resp.code.lt:300".to_string(),
            description: "Filter for successful responses (200-299)".to_string(),
            badge: "2xx".to_string(),
            apply_in_interception: false,
            sort_order: 2,
            created_at: now,
            updated_at: now,
        },
        PresetFilterItem {
            id: format!("def-{}-mutating-methods", project_id),
            project_id: project_id.to_string(),
            name: "POST / PUT / DELETE".to_string(),
            alias: "mutating-methods".to_string(),
            expression: "req.method.in:['POST', 'PUT', 'PATCH', 'DELETE']".to_string(),
            description: "Filter for mutating HTTP request methods".to_string(),
            badge: "Mutating".to_string(),
            apply_in_interception: false,
            sort_order: 3,
            created_at: now,
            updated_at: now,
        },
        PresetFilterItem {
            id: format!("def-{}-json-only", project_id),
            project_id: project_id.to_string(),
            name: "JSON Traffic".to_string(),
            alias: "json-only".to_string(),
            expression: "resp.header[\"content-type\"].cont:\"json\" or req.header[\"content-type\"].cont:\"json\" or req.ext.eq:\".json\"".to_string(),
            description: "Filter for JSON requests or responses".to_string(),
            badge: "API".to_string(),
            apply_in_interception: false,
            sort_order: 4,
            created_at: now,
            updated_at: now,
        },
        PresetFilterItem {
            id: format!("def-{}-slow-requests", project_id),
            project_id: project_id.to_string(),
            name: "Slow (>1s)".to_string(),
            alias: "slow-requests".to_string(),
            expression: "resp.roundtrip.gt:1000".to_string(),
            description: "Requests taking longer than 1,000ms".to_string(),
            badge: "Perf".to_string(),
            apply_in_interception: false,
            sort_order: 5,
            created_at: now,
            updated_at: now,
        },
        PresetFilterItem {
            id: format!("def-{}-has-params", project_id),
            project_id: project_id.to_string(),
            name: "With Query Params".to_string(),
            alias: "has-params".to_string(),
            expression: "req.query.ne:\"\"".to_string(),
            description: "Requests containing URL query parameters".to_string(),
            badge: "Params".to_string(),
            apply_in_interception: false,
            sort_order: 6,
            created_at: now,
            updated_at: now,
        },
    ]
}

pub async fn seed_default_presets_if_empty(
    pool: &sqlx::SqlitePool,
    project_id: &str,
) -> Result<(), String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM preset_filters WHERE project_id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    if count == 0 {
        let defaults = get_default_presets(project_id);
        for item in defaults {
            sqlx::query(
                "INSERT INTO preset_filters (id, project_id, name, alias, expression, description, badge, apply_in_interception, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&item.id)
            .bind(&item.project_id)
            .bind(&item.name)
            .bind(&item.alias)
            .bind(&item.expression)
            .bind(&item.description)
            .bind(&item.badge)
            .bind(if item.apply_in_interception { 1i64 } else { 0i64 })
            .bind(item.sort_order)
            .bind(item.created_at)
            .bind(item.updated_at)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_preset_filters_db(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<PresetFilterItem>, String> {
    let pool = db.pool().await?;
    seed_default_presets_if_empty(&pool, &project_id).await?;

    let rows = sqlx::query_as::<_, DbPresetFilterRow>(
        "SELECT id, project_id, name, alias, expression, description, badge, apply_in_interception, sort_order, created_at, updated_at
         FROM preset_filters
         WHERE project_id = ?
         ORDER BY sort_order ASC, created_at ASC",
    )
    .bind(&project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| PresetFilterItem {
            id: r.id,
            project_id: r.project_id,
            name: r.name,
            alias: r.alias,
            expression: r.expression,
            description: r.description,
            badge: r.badge,
            apply_in_interception: r.apply_in_interception,
            sort_order: r.sort_order,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect())
}

#[tauri::command]
pub async fn save_preset_filter_db(
    db: State<'_, DbState>,
    filter: PresetFilterItem,
) -> Result<PresetFilterItem, String> {
    let pool = db.pool().await?;
    let now = now_ms();

    let created_at = if filter.created_at > 0 {
        filter.created_at
    } else {
        now
    };
    let updated_at = now;

    sqlx::query(
        "INSERT INTO preset_filters (id, project_id, name, alias, expression, description, badge, apply_in_interception, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            alias = excluded.alias,
            expression = excluded.expression,
            description = excluded.description,
            badge = excluded.badge,
            apply_in_interception = excluded.apply_in_interception,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at",
    )
    .bind(&filter.id)
    .bind(&filter.project_id)
    .bind(&filter.name)
    .bind(&filter.alias)
    .bind(&filter.expression)
    .bind(&filter.description)
    .bind(&filter.badge)
    .bind(if filter.apply_in_interception { 1i64 } else { 0i64 })
    .bind(filter.sort_order)
    .bind(created_at)
    .bind(updated_at)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(PresetFilterItem {
        created_at,
        updated_at,
        ..filter
    })
}

#[tauri::command]
pub async fn delete_preset_filter_db(
    db: State<'_, DbState>,
    project_id: String,
    id: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    sqlx::query("DELETE FROM preset_filters WHERE project_id = ? AND id = ?")
        .bind(&project_id)
        .bind(&id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn reset_default_preset_filters_db(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<PresetFilterItem>, String> {
    let pool = db.pool().await?;
    sqlx::query("DELETE FROM preset_filters WHERE project_id = ?")
        .bind(&project_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    seed_default_presets_if_empty(&pool, &project_id).await?;
    get_preset_filters_db(db, project_id).await
}
