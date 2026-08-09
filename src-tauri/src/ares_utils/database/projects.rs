use sqlx::types::chrono;
use std::path::PathBuf;
use uuid::Uuid;

use crate::ares_utils::database::{
    open_project_db, projects_catalog::CatalogState, stamp_ares_file, DatabaseType,
};

#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
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
    temporary: Option<bool>,
    catalog: tauri::State<'_, CatalogState>,
) -> Result<Project, String> {
    let mut path_buf = PathBuf::from(&path);
    if path_buf.extension().and_then(|e| e.to_str()) != Some("ares") {
        path_buf.set_extension("ares");
    }

    if let Some(parent) = path_buf.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {e}"))?;
    }

    if path_buf.exists() {
        return Err("A file with the same namealready exists at this path".into());
    }

    // 1. Create and open project SQLite database
    let pool = open_project_db(&path_buf, DatabaseType::Project)
        .await
        .map_err(|e| format!("Failed to create project database: {e}"))?;

    // 2. Stamp ASCII magic bytes ("ARES" / 0x41524553)
    stamp_ares_file(&pool).await?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let is_temp = temporary.unwrap_or(false);

    // 3. Populate initial project metadata in project file
    sqlx::query(
        "INSERT INTO projects (id, name, description, temporary, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(is_temp)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to insert project record: {e}"))?;

    let meta = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to fetch created project: {e}"))?;

    // 4. Close the project pool (project is only mounted when selected)
    pool.close().await;

    // 5. Register project in catalog database
    let path_str = path_buf.to_string_lossy().to_string();
    sqlx::query(
        "INSERT INTO project_catalog (id, name, path, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(&name)
    .bind(&path_str)
    .bind(now)
    .bind(now)
    .execute(catalog.pool())
    .await
    .map_err(|e| format!("Failed to catalog project: {e}"))?;

    Ok(meta)
}
