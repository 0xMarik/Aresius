use sqlx::types::chrono;
use std::path::PathBuf;
use uuid::Uuid;

use crate::{
    ares_utils::database::{
        open_project_db, projects_catalog::CatalogState, stamp_ares_file, DatabaseType,
    },
    DbState,
};

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct Project {
    pub id: String, // UUID as string — sqlx doesn't map TEXT -> Uuid without the "uuid" feature
    pub name: String,
    pub description: String,
    pub temporary: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn create_project(
    path: String,
    name: String,
    db: tauri::State<'_, DbState>,
    catalog: tauri::State<'_, CatalogState>,
) -> Result<Project, String> {
    let path = PathBuf::from(&path);

    if path.exists() {
        return Err("A file already exists at this path".into());
    }

    let pool = open_project_db(&path, DatabaseType::Project)
        .await
        .map_err(|e| e.to_string())?;

    stamp_ares_file(&pool).await?;

    pool.close().await;

    let id = Uuid::new_v4();
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        "INSERT INTO projects (id, name, description, temporary, created_at, updated_at)
         VALUES (?, ?, '', 0, ?, ?)",
    )
    .bind(id.to_string())
    .bind(&name)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let meta = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = ?")
        .bind(id.to_string())
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    // register in the shared catalog — reuse the already-open pool, don't open a new one
    sqlx::query(
        "INSERT INTO project_catalog (id, name, path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at",
    )
    .bind(id.to_string())
    .bind(&name)
    .bind(path.to_string_lossy().to_string())
    .bind(now)
    .bind(now)
    .execute(catalog.pool())
    .await
    .map_err(|e| e.to_string())?;

    Ok(meta)
}
