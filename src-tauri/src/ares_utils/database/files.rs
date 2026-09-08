use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileSummary {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub line_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileDb {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub line_count: i64,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// List all files in a project (metadata only, excluding content blob for high performance).
pub async fn list_project_files(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<ProjectFileSummary>, String> {
    sqlx::query_as::<_, ProjectFileSummary>(
        "SELECT id, project_id, name, path, size_bytes, line_count, created_at, updated_at
         FROM project_files
         WHERE project_id = ?
         ORDER BY created_at DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list project files: {e}"))
}

/// Insert a new file or wordlist into the project.
pub async fn insert_project_file(
    pool: &SqlitePool,
    project_id: &str,
    name: &str,
    path: &str,
    content: &str,
) -> Result<ProjectFileSummary, String> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let size_bytes = content.len() as i64;
    // Count non-empty/actual lines
    let line_count = if content.is_empty() {
        0
    } else {
        content.lines().count() as i64
    };

    sqlx::query(
        "INSERT INTO project_files (id, project_id, name, path, size_bytes, line_count, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(project_id)
    .bind(name)
    .bind(path)
    .bind(size_bytes)
    .bind(line_count)
    .bind(content)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to insert project file: {e}"))?;

    Ok(ProjectFileSummary {
        id,
        project_id: project_id.to_string(),
        name: name.to_string(),
        path: path.to_string(),
        size_bytes,
        line_count,
        created_at: now,
        updated_at: now,
    })
}

/// Retrieve the full file record including content.
pub async fn get_project_file(
    pool: &SqlitePool,
    file_id: &str,
) -> Result<Option<ProjectFileDb>, String> {
    sqlx::query_as::<_, ProjectFileDb>(
        "SELECT id, project_id, name, path, size_bytes, line_count, content, created_at, updated_at
         FROM project_files
         WHERE id = ?",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch project file: {e}"))
}

/// Retrieve the first N lines of a file for preview.
pub async fn get_project_file_preview(
    pool: &SqlitePool,
    file_id: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    let content: Option<String> = sqlx::query_scalar(
        "SELECT content FROM project_files WHERE id = ?",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch project file preview: {e}"))?;

    match content {
        Some(c) => Ok(c.lines().take(limit).map(|s| s.to_string()).collect()),
        None => Err(format!("Project file '{file_id}' not found")),
    }
}

/// Retrieve all lines of a file for execution in the fuzzer.
pub async fn get_project_file_lines(
    pool: &SqlitePool,
    file_id: &str,
) -> Result<Vec<String>, String> {
    let content: Option<String> = sqlx::query_scalar(
        "SELECT content FROM project_files WHERE id = ?",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to load project file lines: {e}"))?;

    match content {
        Some(c) => Ok(c.lines().map(|s| s.trim_end().to_string()).collect()),
        None => Err(format!("Project file '{file_id}' not found")),
    }
}

/// Delete a file by id.
pub async fn delete_project_file(
    pool: &SqlitePool,
    file_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM project_files WHERE id = ?")
        .bind(file_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to delete project file: {e}"))?;
    Ok(())
}

/// Rename a file by id.
pub async fn rename_project_file(
    pool: &SqlitePool,
    file_id: &str,
    new_name: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("UPDATE project_files SET name = ?, updated_at = ? WHERE id = ?")
        .bind(new_name)
        .bind(now)
        .bind(file_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to rename project file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn list_project_files_db(
    db: tauri::State<'_, crate::ares_utils::database::DbState>,
    project_id: String,
) -> Result<Vec<ProjectFileSummary>, String> {
    let pool = db.pool().await?;
    list_project_files(&pool, &project_id).await
}

#[tauri::command]
pub async fn get_project_file_db(
    db: tauri::State<'_, crate::ares_utils::database::DbState>,
    file_id: String,
) -> Result<Option<ProjectFileDb>, String> {
    let pool = db.pool().await?;
    get_project_file(&pool, &file_id).await
}

#[tauri::command]
pub async fn get_project_file_preview_db(
    db: tauri::State<'_, crate::ares_utils::database::DbState>,
    file_id: String,
    limit: usize,
) -> Result<Vec<String>, String> {
    let pool = db.pool().await?;
    get_project_file_preview(&pool, &file_id, limit).await
}

#[tauri::command]
pub async fn create_project_file_db(
    db: tauri::State<'_, crate::ares_utils::database::DbState>,
    project_id: String,
    name: String,
    path: String,
    content: String,
) -> Result<ProjectFileSummary, String> {
    let pool = db.pool().await?;
    insert_project_file(&pool, &project_id, &name, &path, &content).await
}

#[tauri::command]
pub async fn delete_project_file_db(
    db: tauri::State<'_, crate::ares_utils::database::DbState>,
    file_id: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    delete_project_file(&pool, &file_id).await
}

#[tauri::command]
pub async fn rename_project_file_db(
    db: tauri::State<'_, crate::ares_utils::database::DbState>,
    file_id: String,
    new_name: String,
) -> Result<(), String> {
    let pool = db.pool().await?;
    rename_project_file(&pool, &file_id, &new_name).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn create_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory sqlite");

        sqlx::query(
            "CREATE TABLE projects (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                temporary INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'Test Project', 0, 0);"
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE project_files (
                id          TEXT PRIMARY KEY NOT NULL,
                project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                path        TEXT NOT NULL DEFAULT '',
                size_bytes  INTEGER NOT NULL,
                line_count  INTEGER NOT NULL,
                content     TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );",
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_project_file_crud() {
        let pool = create_test_db().await;

        let content = "admin\nroot\nguest\nuser\n";
        let summary = insert_project_file(&pool, "p1", "usernames.txt", "/tmp/usernames.txt", content)
            .await
            .expect("Insert failed");

        assert_eq!(summary.name, "usernames.txt");
        assert_eq!(summary.line_count, 4);
        assert_eq!(summary.size_bytes, content.len() as i64);

        let files = list_project_files(&pool, "p1").await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].id, summary.id);

        let preview = get_project_file_preview(&pool, &summary.id, 2).await.unwrap();
        assert_eq!(preview, vec!["admin".to_string(), "root".to_string()]);

        let all_lines = get_project_file_lines(&pool, &summary.id).await.unwrap();
        assert_eq!(all_lines.len(), 4);
        assert_eq!(all_lines[0], "admin");

        rename_project_file(&pool, &summary.id, "wordlist.txt").await.unwrap();
        let fetched = get_project_file(&pool, &summary.id).await.unwrap().unwrap();
        assert_eq!(fetched.name, "wordlist.txt");

        delete_project_file(&pool, &summary.id).await.unwrap();
        let empty = list_project_files(&pool, "p1").await.unwrap();
        assert!(empty.is_empty());
    }
}
