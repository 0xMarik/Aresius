use std::path::PathBuf;

use sqlx::SqlitePool;
use tauri::Manager;

use crate::ares_utils::database::{open_project_db, verify_ares_file, DatabaseType, DbState};

// ---------------------------------------------------------------------------
// Project summary (used by list_projects / select_project)
// ---------------------------------------------------------------------------

#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub version: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: Option<i64>,
    /// Computed at query time via fs::metadata; not stored in the DB.
    #[sqlx(skip)]
    pub size_bytes: u64,
}

// ---------------------------------------------------------------------------
// App-wide UI state (stored as key-value rows in app_state)
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub sidebar_collapsed: bool,
    pub active_project_id: Option<String>,
    pub last_page: String,
}

// ---------------------------------------------------------------------------
// CatalogState managed state wrapper
// ---------------------------------------------------------------------------

pub struct CatalogState(SqlitePool);

impl CatalogState {
    pub fn new(pool: SqlitePool) -> Self {
        Self(pool)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.0
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn catalog_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let database_dir = dir.join("database");
    std::fs::create_dir_all(&database_dir).map_err(|e| e.to_string())?;
    Ok(database_dir.join("catalog.db"))
}

/// Read the on-disk file size for a project path.  Returns 0 when the file
/// no longer exists or the metadata call fails, so listing never hard-errors.
fn file_size_bytes(path: &str) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tauri commands — Projects
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_projects(
    catalog: tauri::State<'_, CatalogState>,
) -> Result<Vec<ProjectSummary>, String> {
    let mut rows = sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, version, created_at, updated_at, last_opened_at \
         FROM project_catalog ORDER BY updated_at DESC",
    )
    .fetch_all(catalog.pool())
    .await
    .map_err(|e| e.to_string())?;

    // Populate size_bytes from the filesystem (best-effort).
    for row in &mut rows {
        row.size_bytes = file_size_bytes(&row.path);
    }

    Ok(rows)
}

#[tauri::command]
pub async fn select_project(
    id: String,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<ProjectSummary, String> {
    let mut summary = sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, version, created_at, updated_at, last_opened_at \
         FROM project_catalog WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(catalog.pool())
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Project with ID {} not found in catalog", id))?;

    let path = PathBuf::from(&summary.path);
    if !path.exists() {
        return Err(format!(
            "Project file does not exist at path: {}",
            summary.path
        ));
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

    summary.last_opened_at = Some(now);
    summary.updated_at = now;
    summary.size_bytes = file_size_bytes(&summary.path);

    Ok(summary)
}

#[tauri::command]
pub async fn delete_project(
    id: String,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<(), String> {
    // If the project is currently active, close the DB connection pool first so file locks are released
    if db.get_active_id().await.as_deref() == Some(&id) {
        db.close().await;
    }

    let path_opt: Option<(String,)> = sqlx::query_as("SELECT path FROM project_catalog WHERE id = ?")
        .bind(&id)
        .fetch_optional(catalog.pool())
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM project_catalog WHERE id = ?")
        .bind(&id)
        .execute(catalog.pool())
        .await
        .map_err(|e| e.to_string())?;

    // Clear active_project_id from app_state if this project was the active one
    let _ = sqlx::query("UPDATE app_state SET value = NULL WHERE key = 'active_project_id' AND value = ?")
        .bind(&id)
        .execute(catalog.pool())
        .await;

    if let Some((path_str,)) = path_opt {
        let path = PathBuf::from(&path_str);
        if path.exists() {
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
                // Also remove companion WAL/SHM/journal files if present
                let wal = PathBuf::from(format!("{}-wal", path_str));
                if wal.exists() {
                    let _ = std::fs::remove_file(wal);
                }
                let shm = PathBuf::from(format!("{}-shm", path_str));
                if shm.exists() {
                    let _ = std::fs::remove_file(shm);
                }
                let journal = PathBuf::from(format!("{}-journal", path_str));
                if journal.exists() {
                    let _ = std::fs::remove_file(journal);
                }
            }
        }
    }

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

// ---------------------------------------------------------------------------
// Tauri commands — App state
// ---------------------------------------------------------------------------

/// Load persisted UI state from the catalog DB.
#[tauri::command]
pub async fn get_app_state(
    catalog: tauri::State<'_, CatalogState>,
) -> Result<AppState, String> {
    // Read all rows at once.
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT key, value FROM app_state WHERE key IN ('sidebar_collapsed', 'active_project_id', 'last_page')")
            .fetch_all(catalog.pool())
            .await
            .map_err(|e| e.to_string())?;

    let mut sidebar_collapsed = false;
    let mut active_project_id: Option<String> = None;
    let mut last_page = "/projects".to_string();

    for (key, value) in rows {
        match key.as_str() {
            "sidebar_collapsed" => {
                sidebar_collapsed = value.as_deref() == Some("true");
            }
            "active_project_id" => {
                active_project_id = value.filter(|v| !v.is_empty());
            }
            "last_page" => {
                if let Some(v) = value {
                    if !v.is_empty() {
                        last_page = v;
                    }
                }
            }
            _ => {}
        }
    }

    Ok(AppState {
        sidebar_collapsed,
        active_project_id,
        last_page,
    })
}

/// Persist UI state to the catalog DB.
#[tauri::command]
pub async fn save_app_state(
    state: AppState,
    catalog: tauri::State<'_, CatalogState>,
) -> Result<(), String> {
    let sidebar_val = if state.sidebar_collapsed { "true" } else { "false" };

    sqlx::query(
        "INSERT INTO app_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("sidebar_collapsed")
    .bind(sidebar_val)
    .execute(catalog.pool())
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO app_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("active_project_id")
    .bind(&state.active_project_id)
    .execute(catalog.pool())
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO app_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("last_page")
    .bind(&state.last_page)
    .execute(catalog.pool())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
