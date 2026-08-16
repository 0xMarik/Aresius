use crate::ares_utils::database::DbState;
use crate::proxy::interceptor::is_regex_pattern;
use serde::{Deserialize, Serialize};
use sqlx::types::chrono;
use tauri::State;

// ─── Structs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbScopeRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbScopeRuleRow {
    pub id: String,
    pub scope_id: String,
    pub rule_type: String,     // 'allow' | 'deny'
    pub pattern: String,
    pub pattern_type: String, // 'glob' | 'regex'
    pub enabled: bool,
    pub order_index: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRuleItem {
    pub id: String,
    pub pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeItem {
    pub id: String,
    pub name: String,
    pub color: String,
    pub allow: Vec<ScopeRuleItem>,
    pub deny: Vec<ScopeRuleItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeProjectData {
    pub scopes: Vec<ScopeItem>,
    pub active_scope_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbInterceptorSettings {
    pub project_id: String,
    pub requests_enabled: bool,
    pub responses_enabled: bool,
    pub scope_filter_enabled: bool,
    pub updated_at: i64,
}

// ─── Scope Query Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_scope_project_data(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<ScopeProjectData, String> {
    let pool = db.pool().await?;

    let scopes_rows = sqlx::query_as::<_, DbScopeRow>(
        "SELECT id, project_id, name, color, is_active, created_at, updated_at
         FROM scopes
         WHERE project_id = ?
         ORDER BY created_at ASC",
    )
    .bind(&project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch scopes: {e}"))?;

    let mut active_scope_id: Option<String> = None;
    let mut scopes = Vec::with_capacity(scopes_rows.len());

    for s_row in scopes_rows {
        if s_row.is_active {
            active_scope_id = Some(s_row.id.clone());
        }

        let rules_rows = sqlx::query_as::<_, DbScopeRuleRow>(
            "SELECT id, scope_id, rule_type, pattern, pattern_type, enabled, order_index, created_at
             FROM scope_rules
             WHERE scope_id = ?
             ORDER BY order_index ASC, created_at ASC",
        )
        .bind(&s_row.id)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch rules for scope {}: {e}", s_row.id))?;

        let mut allow = Vec::new();
        let mut deny = Vec::new();

        for r in rules_rows {
            let item = ScopeRuleItem {
                id: r.id,
                pattern: r.pattern,
            };
            if r.rule_type == "allow" {
                allow.push(item);
            } else {
                deny.push(item);
            }
        }

        scopes.push(ScopeItem {
            id: s_row.id,
            name: s_row.name,
            color: s_row.color,
            allow,
            deny,
        });
    }

    Ok(ScopeProjectData {
        scopes,
        active_scope_id,
    })
}

#[tauri::command]
pub async fn create_scope_db(
    db: State<'_, DbState>,
    project_id: String,
    scope_id: String,
    name: String,
    color: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        "INSERT INTO scopes (id, project_id, name, color, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&scope_id)
    .bind(&project_id)
    .bind(&name)
    .bind(&color)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to insert scope: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_scope_db(
    db: State<'_, DbState>,
    scope_id: String,
) -> Result<(), String> {
    let pool = db.pool().await?;

    sqlx::query("DELETE FROM scopes WHERE id = ?")
        .bind(&scope_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete scope: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn rename_scope_db(
    db: State<'_, DbState>,
    scope_id: String,
    name: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query("UPDATE scopes SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(now)
        .bind(&scope_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to rename scope: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn set_scope_color_db(
    db: State<'_, DbState>,
    scope_id: String,
    color: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query("UPDATE scopes SET color = ?, updated_at = ? WHERE id = ?")
        .bind(&color)
        .bind(now)
        .bind(&scope_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update scope color: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn set_active_scope_db(
    db: State<'_, DbState>,
    project_id: String,
    scope_id: Option<String>,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    // Deactivate all scopes in project
    sqlx::query("UPDATE scopes SET is_active = 0, updated_at = ? WHERE project_id = ?")
        .bind(now)
        .bind(&project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to deactivate scopes: {e}"))?;

    // Activate the requested scope if provided
    if let Some(target_id) = scope_id {
        sqlx::query("UPDATE scopes SET is_active = 1, updated_at = ? WHERE id = ? AND project_id = ?")
            .bind(now)
            .bind(&target_id)
            .bind(&project_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to set active scope: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit active scope change: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn add_scope_rule_db(
    db: State<'_, DbState>,
    rule_id: String,
    scope_id: String,
    rule_type: String,
    pattern: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();
    let pat_type = if is_regex_pattern(&pattern) {
        "regex"
    } else {
        "glob"
    };

    sqlx::query(
        "INSERT INTO scope_rules (id, scope_id, rule_type, pattern, pattern_type, enabled, order_index, created_at)
         VALUES (?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(order_index) + 1, 0) FROM scope_rules WHERE scope_id = ?), ?)",
    )
    .bind(&rule_id)
    .bind(&scope_id)
    .bind(&rule_type)
    .bind(&pattern)
    .bind(pat_type)
    .bind(&scope_id)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to insert scope rule: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn remove_scope_rule_db(
    db: State<'_, DbState>,
    rule_id: String,
) -> Result<(), String> {
    let pool = db.pool().await?;

    sqlx::query("DELETE FROM scope_rules WHERE id = ?")
        .bind(&rule_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to remove scope rule: {e}"))?;

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScopeBatchPayload {
    pub project_id: String,
    pub mode: String, // 'create' | 'replace' | 'merge'
    pub scope_id: Option<String>,
    pub scope_name: Option<String>,
    pub include: Vec<ScopeRuleItem>,
    pub exclude: Vec<ScopeRuleItem>,
}

#[tauri::command]
pub async fn batch_import_scope_rules_db(
    db: State<'_, DbState>,
    payload: ImportScopeBatchPayload,
) -> Result<String, String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    let final_scope_id = if payload.mode == "create" || payload.scope_id.is_none() {
        let new_id = uuid::Uuid::new_v4().to_string();
        let name = payload.scope_name.unwrap_or_else(|| "Imported Scope".into());
        let color = "#6366f1"; // default indigo

        sqlx::query(
            "INSERT INTO scopes (id, project_id, name, color, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(&new_id)
        .bind(&payload.project_id)
        .bind(&name)
        .bind(color)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to create scope: {e}"))?;

        new_id
    } else {
        let target_id = payload.scope_id.unwrap();
        if payload.mode == "replace" {
            sqlx::query("DELETE FROM scope_rules WHERE scope_id = ?")
                .bind(&target_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed to clear existing rules for replacement: {e}"))?;
        }
        target_id
    };

    // Insert Allow rules
    for (idx, rule) in payload.include.into_iter().enumerate() {
        let pat_type = if is_regex_pattern(&rule.pattern) {
            "regex"
        } else {
            "glob"
        };
        sqlx::query(
            "INSERT OR IGNORE INTO scope_rules (id, scope_id, rule_type, pattern, pattern_type, enabled, order_index, created_at)
             VALUES (?, ?, 'allow', ?, ?, 1, ?, ?)",
        )
        .bind(&rule.id)
        .bind(&final_scope_id)
        .bind(&rule.pattern)
        .bind(pat_type)
        .bind(idx as i64)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert allow rule: {e}"))?;
    }

    // Insert Deny rules
    for (idx, rule) in payload.exclude.into_iter().enumerate() {
        let pat_type = if is_regex_pattern(&rule.pattern) {
            "regex"
        } else {
            "glob"
        };
        sqlx::query(
            "INSERT OR IGNORE INTO scope_rules (id, scope_id, rule_type, pattern, pattern_type, enabled, order_index, created_at)
             VALUES (?, ?, 'deny', ?, ?, 1, ?, ?)",
        )
        .bind(&rule.id)
        .bind(&final_scope_id)
        .bind(&rule.pattern)
        .bind(pat_type)
        .bind(idx as i64)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert deny rule: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit batch import: {e}"))?;

    Ok(final_scope_id)
}

// ─── Interceptor Settings Commands ───────────────────────────────────────────

#[tauri::command]
pub async fn get_interceptor_settings_db(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Option<DbInterceptorSettings>, String> {
    let pool = db.pool().await?;

    let settings = sqlx::query_as::<_, DbInterceptorSettings>(
        "SELECT project_id, requests_enabled, responses_enabled, scope_filter_enabled, updated_at
         FROM interceptor_settings
         WHERE project_id = ?",
    )
    .bind(&project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to fetch interceptor settings: {e}"))?;

    Ok(settings)
}

#[tauri::command]
pub async fn save_interceptor_settings_db(
    db: State<'_, DbState>,
    settings: DbInterceptorSettings,
) -> Result<(), String> {
    let pool = db.pool().await?;
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        "INSERT INTO interceptor_settings (project_id, requests_enabled, responses_enabled, scope_filter_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
             requests_enabled = excluded.requests_enabled,
             responses_enabled = excluded.responses_enabled,
             scope_filter_enabled = excluded.scope_filter_enabled,
             updated_at = excluded.updated_at",
    )
    .bind(&settings.project_id)
    .bind(settings.requests_enabled)
    .bind(settings.responses_enabled)
    .bind(settings.scope_filter_enabled)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to save interceptor settings: {e}"))?;

    Ok(())
}
