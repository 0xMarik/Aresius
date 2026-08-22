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
    /// Indicates whether the project file currently exists on disk.
    #[sqlx(skip)]
    pub exists: bool,
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
    pub font_size_scale: Option<f64>,
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

    // Populate size_bytes and exists from the filesystem.
    for row in &mut rows {
        let p = std::path::Path::new(&row.path);
        row.exists = p.is_file();
        row.size_bytes = if row.exists { file_size_bytes(&row.path) } else { 0 };
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
    if !path.exists() || !path.is_file() {
        summary.exists = false;
        summary.size_bytes = 0;
        return Err(format!(
            "Project file not found at path: {}\nThe file may have been moved, renamed, or deleted.",
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
    summary.exists = true;
    summary.size_bytes = file_size_bytes(&summary.path);

    Ok(summary)
}

/// Opens an existing `.ares` project file from disk (via native file picker dialog if file_path is None,
/// or directly from the specified file_path).
/// Verifies the file extension and Aresius magic bytes, extracts the metadata from the database,
/// inserts/updates the project catalog record, mounts the project into DbState, and updates app_state.
#[tauri::command]
pub async fn open_project_file(
    file_path: Option<String>,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<Option<ProjectSummary>, String> {
    let path = match file_path {
        Some(p) => PathBuf::from(p),
        None => {
            let file = rfd::AsyncFileDialog::new()
                .add_filter("Aresius Project (*.ares)", &["ares"])
                .set_title("Open Aresius Project")
                .pick_file()
                .await;
            match file {
                Some(handle) => handle.path().to_path_buf(),
                None => return Ok(None),
            }
        }
    };

    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("Selected path is not a file: {}", path.display()));
    }

    // Verify extension is .ares
    let is_ares_ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("ares"))
        .unwrap_or(false);

    if !is_ares_ext {
        return Err(format!(
            "Invalid file extension. Expected a '.ares' project file, got '{}'",
            path.extension().and_then(|e| e.to_str()).unwrap_or("none")
        ));
    }

    // Open the SQLite database and run project migrations
    let pool = open_project_db(&path, DatabaseType::Project)
        .await
        .map_err(|e| format!("Failed to open project file: {e}"))?;

    // Verify magic bytes (PRAGMA application_id = 0x41524553)
    verify_ares_file(&pool).await.map_err(|e| {
        format!("File verification failed: {e}. The file is not a valid Aresius project.")
    })?;

    // Read the project metadata from the project's own `projects` table
    let meta_row: Option<(String, String, Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT id, name, version, created_at, updated_at FROM projects LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to read project metadata from file: {e}"))?;

    let (id, name, version_opt, created_at, _) = meta_row.ok_or_else(|| {
        "Invalid project file: no project metadata found in database".to_string()
    })?;

    let version_str = version_opt.unwrap_or_else(|| "0.1.0".to_string());
    let path_str = path.to_string_lossy().to_string();
    let now = sqlx::types::chrono::Utc::now().timestamp_millis();

    // Remove any conflicting records in catalog matching id or path
    let _ = sqlx::query("DELETE FROM project_catalog WHERE id = ? OR path = ?")
        .bind(&id)
        .bind(&path_str)
        .execute(catalog.pool())
        .await;

    // Insert into project_catalog
    sqlx::query(
        "INSERT INTO project_catalog (id, name, path, version, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&path_str)
    .bind(&version_str)
    .bind(created_at)
    .bind(now)
    .bind(now)
    .execute(catalog.pool())
    .await
    .map_err(|e| format!("Failed to catalog project: {e}"))?;

    // Mount/set active project database in DbState
    db.set(id.clone(), pool).await;

    // Update app_state in catalog DB
    let _ = sqlx::query(
        "INSERT INTO app_state (key, value) VALUES ('active_project_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&id)
    .execute(catalog.pool())
    .await;

    let size_bytes = file_size_bytes(&path_str);

    Ok(Some(ProjectSummary {
        id,
        name,
        path: path_str,
        version: version_str,
        created_at,
        updated_at: now,
        last_opened_at: Some(now),
        size_bytes,
        exists: true,
    }))
}

/// Relocate or update the file path of a catalog project that was moved or renamed.
/// If `new_path` is None, opens the native file dialog for the user to select the new file location.
/// Verifies the selected file is a valid .ares project, updates the catalog database,
/// optionally selects the project, and returns the updated ProjectSummary.
#[tauri::command]
pub async fn relocate_project(
    id: String,
    new_path: Option<String>,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<Option<ProjectSummary>, String> {
    let path = match new_path {
        Some(p) => PathBuf::from(p),
        None => {
            let file = rfd::AsyncFileDialog::new()
                .add_filter("Aresius Project (*.ares)", &["ares"])
                .set_title("Locate Moved / Renamed Project File")
                .pick_file()
                .await;
            match file {
                Some(handle) => handle.path().to_path_buf(),
                None => return Ok(None),
            }
        }
    };

    if !path.exists() || !path.is_file() {
        return Err(format!("Selected file does not exist: {}", path.display()));
    }

    let is_ares_ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("ares"))
        .unwrap_or(false);

    if !is_ares_ext {
        return Err(format!(
            "Invalid file extension. Expected a '.ares' project file, got '{}'",
            path.extension().and_then(|e| e.to_str()).unwrap_or("none")
        ));
    }

    let pool = open_project_db(&path, DatabaseType::Project)
        .await
        .map_err(|e| format!("Failed to open project file: {e}"))?;

    verify_ares_file(&pool).await.map_err(|e| {
        format!("File verification failed: {e}. The file is not a valid Aresius project.")
    })?;

    // Read metadata inside the relocated database
    let meta_row: Option<(String, String, Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT id, name, version, created_at, updated_at FROM projects LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to read project metadata: {e}"))?;

    let (file_id, name, version_opt, created_at, _) = meta_row.ok_or_else(|| {
        "Invalid project file: no project metadata found in database".to_string()
    })?;

    let version_str = version_opt.unwrap_or_else(|| "0.1.0".to_string());
    let path_str = path.to_string_lossy().to_string();
    let now = sqlx::types::chrono::Utc::now().timestamp_millis();

    // Remove any catalog entries matching the old id, the new file_id, or the new path
    let _ = sqlx::query("DELETE FROM project_catalog WHERE id = ? OR id = ? OR path = ?")
        .bind(&id)
        .bind(&file_id)
        .bind(&path_str)
        .execute(catalog.pool())
        .await;

    // Insert updated record using the canonical file_id and new path
    sqlx::query(
        "INSERT INTO project_catalog (id, name, path, version, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&file_id)
    .bind(&name)
    .bind(&path_str)
    .bind(&version_str)
    .bind(created_at)
    .bind(now)
    .bind(now)
    .execute(catalog.pool())
    .await
    .map_err(|e| format!("Failed to update project catalog: {e}"))?;

    // Mount/set active project in DbState
    db.set(file_id.clone(), pool).await;

    // Update app_state
    let _ = sqlx::query(
        "INSERT INTO app_state (key, value) VALUES ('active_project_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&file_id)
    .execute(catalog.pool())
    .await;

    let size_bytes = file_size_bytes(&path_str);

    Ok(Some(ProjectSummary {
        id: file_id,
        name,
        path: path_str,
        version: version_str,
        created_at,
        updated_at: now,
        last_opened_at: Some(now),
        size_bytes,
        exists: true,
    }))
}

/// Update a project's name (and optional description) in both the catalog DB
/// and in the project's internal SQLite database.
#[tauri::command]
pub async fn update_project_details(
    id: String,
    name: String,
    description: Option<String>,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<ProjectSummary, String> {
    if name.trim().is_empty() {
        return Err("Project name cannot be empty".to_string());
    }

    let trimmed_name = name.trim().to_string();
    let desc = description.unwrap_or_default();
    let now = sqlx::types::chrono::Utc::now().timestamp_millis();

    let mut summary = sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, version, created_at, updated_at, last_opened_at \
         FROM project_catalog WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(catalog.pool())
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Project with ID {} not found in catalog", id))?;

    // 1. Update project_catalog
    sqlx::query("UPDATE project_catalog SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&trimmed_name)
        .bind(now)
        .bind(&id)
        .execute(catalog.pool())
        .await
        .map_err(|e| e.to_string())?;

    // 2. Update inside project file if it exists
    let path = PathBuf::from(&summary.path);
    if path.exists() && path.is_file() {
        if db.get_active_id().await.as_deref() == Some(&id) {
            if let Ok(pool) = db.pool().await {
                let _ = sqlx::query("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?")
                    .bind(&trimmed_name)
                    .bind(&desc)
                    .bind(now)
                    .bind(&id)
                    .execute(&pool)
                    .await;
            }
        } else if let Ok(temp_pool) = open_project_db(&path, DatabaseType::Project).await {
            let _ = sqlx::query("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?")
                .bind(&trimmed_name)
                .bind(&desc)
                .bind(now)
                .bind(&id)
                .execute(&temp_pool)
                .await;
            temp_pool.close().await;
        }
    }

    summary.name = trimmed_name;
    summary.updated_at = now;
    summary.exists = path.is_file();
    summary.size_bytes = if summary.exists { file_size_bytes(&summary.path) } else { 0 };

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
        sqlx::query_as("SELECT key, value FROM app_state WHERE key IN ('sidebar_collapsed', 'active_project_id', 'last_page', 'font_size_scale')")
            .fetch_all(catalog.pool())
            .await
            .map_err(|e| e.to_string())?;

    let mut sidebar_collapsed = false;
    let mut active_project_id: Option<String> = None;
    let mut last_page = "/projects".to_string();
    let mut font_size_scale: Option<f64> = None;

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
            "font_size_scale" => {
                if let Some(v) = value {
                    font_size_scale = v.parse::<f64>().ok();
                }
            }
            _ => {}
        }
    }

    Ok(AppState {
        sidebar_collapsed,
        active_project_id,
        last_page,
        font_size_scale,
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

    if let Some(scale) = state.font_size_scale {
        sqlx::query(
            "INSERT INTO app_state (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind("font_size_scale")
        .bind(scale.to_string())
        .execute(catalog.pool())
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
