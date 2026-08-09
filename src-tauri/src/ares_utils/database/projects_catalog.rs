use std::path::PathBuf;

use sqlx::SqlitePool;
use tauri::Manager;

use crate::ares_utils::database::{open_project_db, verify_ares_file, DatabaseType, DbState};

#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: Option<i64>,
}

pub struct CatalogState(SqlitePool);

impl CatalogState {
    pub fn new(pool: SqlitePool) -> Self {
        Self(pool)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.0
    }
}

pub fn catalog_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let database_dir = dir.join("database");
    std::fs::create_dir_all(&database_dir).map_err(|e| e.to_string())?;
    Ok(database_dir.join("catalog.db"))
}

#[tauri::command]
pub async fn list_projects(
    catalog: tauri::State<'_, CatalogState>,
) -> Result<Vec<ProjectSummary>, String> {
    sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, created_at, updated_at, last_opened_at FROM project_catalog ORDER BY updated_at DESC",
    )
    .fetch_all(catalog.pool())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_project(
    id: String,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<ProjectSummary, String> {
    let summary = sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, created_at, updated_at, last_opened_at FROM project_catalog WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(catalog.pool())
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Project with ID {} not found in catalog", id))?;

    let path = PathBuf::from(&summary.path);
    if !path.exists() {
        return Err(format!("Project file does not exist at path: {}", summary.path));
    }

    let pool = open_project_db(&path, DatabaseType::Project)
        .await
        .map_err(|e| format!("Failed to open project file: {e}"))?;

    verify_ares_file(&pool).await?;

    db.set(id.clone(), pool).await;

    let now = sqlx::types::chrono::Utc::now().timestamp_millis();
    sqlx::query("UPDATE project_catalog SET last_opened_at = ?, updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(now)
        .bind(&id)
        .execute(catalog.pool())
        .await
        .map_err(|e| e.to_string())?;

    Ok(ProjectSummary {
        last_opened_at: Some(now),
        updated_at: now,
        ..summary
    })
}

#[tauri::command]
pub async fn delete_project(
    id: String,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<(), String> {
    if db.get_active_id().await.as_deref() == Some(&id) {
        db.close().await;
    }

    sqlx::query("DELETE FROM project_catalog WHERE id = ?")
        .bind(&id)
        .execute(catalog.pool())
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_default_project_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    let projects_dir = dir.join("Aresius").join("projects");
    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
    Ok(projects_dir.to_string_lossy().to_string())
}
