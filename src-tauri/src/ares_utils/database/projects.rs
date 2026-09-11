use std::path::PathBuf;
use sqlx::types::chrono;
use sqlx::SqlitePool;
use tauri::Manager;
use uuid::Uuid;

use crate::ares_utils::database::{
    open_project_db, stamp_ares_file, verify_ares_file, DatabaseType, DbState,
};

/// The version stamped into every newly-created project.
pub const PROJECT_VERSION: &str = "0.1.0";

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub version: String,
    pub description: String,
    pub temporary: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: Option<i64>,
    pub size_bytes: u64,
    pub exists: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct ProjectDbRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub temporary: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub version: String,
    pub temporary: bool,
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

/// Read the on-disk file size for a project path. Returns 0 when the file
/// no longer exists or the metadata call fails, so listing never hard-errors.
pub fn file_size_bytes(path: &str) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tauri commands — Projects & Catalog
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_projects(
    catalog: tauri::State<'_, CatalogState>,
) -> Result<Vec<ProjectSummary>, String> {
    let mut rows = sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, version, temporary, created_at, updated_at, last_opened_at \
         FROM project_catalog ORDER BY updated_at DESC",
    )
    .fetch_all(catalog.pool())
    .await
    .map_err(|e| e.to_string())?;

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
        "SELECT id, name, path, version, temporary, created_at, updated_at, last_opened_at \
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

#[tauri::command]
pub async fn create_project(
    path: String,
    name: String,
    temporary: Option<bool>,
    catalog: tauri::State<'_, CatalogState>,
) -> Result<Project, String> {
    #[cfg(unix)]
    let path = path.replace('\\', "/");

    let mut path_buf = PathBuf::from(&path);
    if path_buf.extension().and_then(|e| e.to_str()) != Some("ares") {
        path_buf.set_extension("ares");
    }

    if let Some(parent) = path_buf.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {e}"))?;
    }

    if path_buf.exists() {
        return Err("A file with the same name already exists at this path".into());
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
        "INSERT INTO projects (id, name, description, temporary, created_at, updated_at, version)
         VALUES (?, ?, '', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(is_temp)
    .bind(now)
    .bind(now)
    .bind(PROJECT_VERSION)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to insert project record: {e}"))?;

    let meta = sqlx::query_as::<_, ProjectDbRow>("SELECT id, name, description, temporary, created_at, updated_at FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to fetch created project: {e}"))?;

    // Seed default Match & Replace rules
    let _ = crate::ares_utils::database::match_replace::seed_default_match_replace_rules(&pool, &id).await;

    // 4. Close the project pool (project is only mounted when selected)
    pool.close().await;

    // 5. Register project in catalog database (including version and temporary)
    let path_str = path_buf.to_string_lossy().to_string();
    sqlx::query(
        "INSERT INTO project_catalog (id, name, path, version, temporary, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at, temporary = excluded.temporary",
    )
    .bind(&id)
    .bind(&name)
    .bind(&path_str)
    .bind(PROJECT_VERSION)
    .bind(is_temp)
    .bind(now)
    .bind(now)
    .execute(catalog.pool())
    .await
    .map_err(|e| format!("Failed to catalog project: {e}"))?;

    let size_bytes = std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);

    Ok(Project {
        id: meta.id,
        name: meta.name,
        path: path_str,
        version: PROJECT_VERSION.to_string(),
        description: meta.description,
        temporary: meta.temporary,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        last_opened_at: None,
        size_bytes,
        exists: true,
    })
}

/// Opens an existing `.ares` project file from disk (via native file picker dialog if file_path is None,
/// or directly from the specified file_path).
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

    let meta_row: Option<(String, String, Option<String>, i64, i64, bool)> = sqlx::query_as(
        "SELECT id, name, version, created_at, updated_at, temporary FROM projects LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to read project metadata from file: {e}"))?;

    let (id, name, version_opt, created_at, _, is_temp) = meta_row.ok_or_else(|| {
        "Invalid project file: no project metadata found in database".to_string()
    })?;

    let version_str = version_opt.unwrap_or_else(|| "0.1.0".to_string());
    let path_str = path.to_string_lossy().to_string();
    let now = sqlx::types::chrono::Utc::now().timestamp_millis();

    let _ = sqlx::query("DELETE FROM project_catalog WHERE id = ? OR path = ?")
        .bind(&id)
        .bind(&path_str)
        .execute(catalog.pool())
        .await;

    sqlx::query(
        "INSERT INTO project_catalog (id, name, path, version, temporary, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&path_str)
    .bind(&version_str)
    .bind(is_temp)
    .bind(created_at)
    .bind(now)
    .bind(now)
    .execute(catalog.pool())
    .await
    .map_err(|e| format!("Failed to catalog project: {e}"))?;

    db.set(id.clone(), pool).await;

    let size_bytes = file_size_bytes(&path_str);

    Ok(Some(ProjectSummary {
        id,
        name,
        path: path_str,
        version: version_str,
        temporary: is_temp,
        created_at,
        updated_at: now,
        last_opened_at: Some(now),
        size_bytes,
        exists: true,
    }))
}

/// Relocate or update the file path of a catalog project that was moved or renamed.
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

    let meta_row: Option<(String, String, Option<String>, i64, i64, bool)> = sqlx::query_as(
        "SELECT id, name, version, created_at, updated_at, temporary FROM projects LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to read project metadata: {e}"))?;

    let (file_id, name, version_opt, created_at, _, is_temp) = meta_row.ok_or_else(|| {
        "Invalid project file: no project metadata found in database".to_string()
    })?;

    let version_str = version_opt.unwrap_or_else(|| "0.1.0".to_string());
    let path_str = path.to_string_lossy().to_string();
    let now = sqlx::types::chrono::Utc::now().timestamp_millis();

    let _ = sqlx::query("DELETE FROM project_catalog WHERE id = ? OR id = ? OR path = ?")
        .bind(&id)
        .bind(&file_id)
        .bind(&path_str)
        .execute(catalog.pool())
        .await;

    sqlx::query(
        "INSERT INTO project_catalog (id, name, path, version, temporary, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&file_id)
    .bind(&name)
    .bind(&path_str)
    .bind(&version_str)
    .bind(is_temp)
    .bind(created_at)
    .bind(now)
    .bind(now)
    .execute(catalog.pool())
    .await
    .map_err(|e| format!("Failed to update project catalog: {e}"))?;

    db.set(file_id.clone(), pool).await;

    let size_bytes = file_size_bytes(&path_str);

    Ok(Some(ProjectSummary {
        id: file_id,
        name,
        path: path_str,
        version: version_str,
        temporary: is_temp,
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
        "SELECT id, name, path, version, temporary, created_at, updated_at, last_opened_at \
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

    if let Some((path_str,)) = path_opt {
        let path = PathBuf::from(&path_str);
        if path.exists() {
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
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

#[tauri::command]
pub async fn save_temporary_project(
    id: String,
    new_name: Option<String>,
    new_path: Option<String>,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<ProjectSummary, String> {
    let mut summary = sqlx::query_as::<_, ProjectSummary>(
        "SELECT id, name, path, version, temporary, created_at, updated_at, last_opened_at \
         FROM project_catalog WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(catalog.pool())
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Project with ID {} not found in catalog", id))?;

    let trimmed_name = new_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| summary.name.clone());

    let mut target_path = PathBuf::from(&summary.path);
    if let Some(p) = new_path.filter(|p| !p.trim().is_empty()) {
        let mut p_buf = PathBuf::from(p.trim());
        if p_buf.extension().and_then(|e| e.to_str()) != Some("ares") {
            p_buf.set_extension("ares");
        }
        target_path = p_buf;
    }

    let old_path = PathBuf::from(&summary.path);
    let is_path_changed = target_path != old_path;

    if is_path_changed {
        if target_path.exists() {
            return Err("A file already exists at the specified path".to_string());
        }
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination directories: {e}"))?;
        }
    }

    let is_active = db.get_active_id().await.as_deref() == Some(&id);

    // If path changed and project is active, flush WAL and close active pool before moving
    if is_path_changed && is_active {
        if let Ok(pool) = db.pool().await {
            let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);").execute(&pool).await;
        }
        db.close().await;
    }

    // Move file to new location if path changed
    if is_path_changed {
        if old_path.exists() {
            std::fs::rename(&old_path, &target_path).or_else(|_| {
                std::fs::copy(&old_path, &target_path).map(|_| {
                    let _ = std::fs::remove_file(&old_path);
                })
            }).map_err(|e| format!("Failed to move project file to destination: {e}"))?;

            let old_path_str = old_path.to_string_lossy().to_string();
            let _ = std::fs::remove_file(format!("{}-wal", old_path_str));
            let _ = std::fs::remove_file(format!("{}-shm", old_path_str));
            let _ = std::fs::remove_file(format!("{}-journal", old_path_str));
        }
    }

    let now = sqlx::types::chrono::Utc::now().timestamp_millis();
    let target_path_str = target_path.to_string_lossy().to_string();

    // If active, reopen db connection at the destination path
    if is_active {
        let pool = open_project_db(&target_path, DatabaseType::Project)
            .await
            .map_err(|e| format!("Failed to open project file at new path: {e}"))?;
        db.set(id.clone(), pool).await;
    }

    // Update inside project file (set temporary = 0, name, path, updated_at)
    if target_path.exists() && target_path.is_file() {
        if is_active {
            if let Ok(pool) = db.pool().await {
                let _ = sqlx::query("UPDATE projects SET temporary = 0, name = ?, path = ?, updated_at = ? WHERE id = ?")
                    .bind(&trimmed_name)
                    .bind(&target_path_str)
                    .bind(now)
                    .bind(&id)
                    .execute(&pool)
                    .await;
            }
        } else if let Ok(temp_pool) = open_project_db(&target_path, DatabaseType::Project).await {
            let _ = sqlx::query("UPDATE projects SET temporary = 0, name = ?, path = ?, updated_at = ? WHERE id = ?")
                .bind(&trimmed_name)
                .bind(&target_path_str)
                .bind(now)
                .bind(&id)
                .execute(&temp_pool)
                .await;
            temp_pool.close().await;
        }
    }

    // Update project_catalog
    sqlx::query("UPDATE project_catalog SET temporary = 0, name = ?, path = ?, updated_at = ? WHERE id = ?")
        .bind(&trimmed_name)
        .bind(&target_path_str)
        .bind(now)
        .bind(&id)
        .execute(catalog.pool())
        .await
        .map_err(|e| format!("Failed to update project catalog: {e}"))?;

    summary.temporary = false;
    summary.name = trimmed_name;
    summary.path = target_path_str;
    summary.updated_at = now;
    summary.exists = target_path.is_file();
    summary.size_bytes = if summary.exists { file_size_bytes(&summary.path) } else { 0 };

    Ok(summary)
}

#[tauri::command]
pub async fn exit_app(
    discard_active_if_temp: bool,
    app: tauri::AppHandle,
    catalog: tauri::State<'_, CatalogState>,
    db: tauri::State<'_, DbState>,
) -> Result<(), String> {
    if discard_active_if_temp {
        if let Some(active_id) = db.get_active_id().await {
            let row: Option<(bool,)> = sqlx::query_as("SELECT temporary FROM project_catalog WHERE id = ?")
                .bind(&active_id)
                .fetch_optional(catalog.pool())
                .await
                .map_err(|e| e.to_string())?;

            if let Some((true,)) = row {
                let _ = delete_project(active_id, catalog, db).await;
            }
        }
    }

    crate::app_setup::set_exiting(true);
    crate::ares_utils::shutdown_gracefully(&app).await;
    app.exit(0);
    Ok(())
}
