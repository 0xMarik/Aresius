use std::path::PathBuf;

use sqlx::SqlitePool;
use tauri::Manager;

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct CatalogState(SqlitePool); // field stays private

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
    print!("list projects triggered");
    sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, created_at, updated_at FROM project_catalog",
    )
    .fetch_all(catalog.pool())
    .await
    .map_err(|e| e.to_string())
}
