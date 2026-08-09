use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqlitePool,
};
use std::str::FromStr;
use tokio::sync::RwLock;
pub mod http_history;
pub mod projects;
pub mod projects_catalog;

/// 4-byte fingerprint written into every Aresius project file.
/// Spells "ARES" in ASCII when you look at the bytes: 0x41 'A' 0x52 'R' 0x45 'E' 0x53 'S'.
pub const ARES_APPLICATION_ID: i64 = 0x41524553;

/// Call ONCE, right after a brand new file is created.
pub async fn stamp_ares_file(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("PRAGMA application_id = 0x41524553")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Verify that an opened SQLite database file has the Aresius magic bytes fingerprint.
pub async fn verify_ares_file(pool: &SqlitePool) -> Result<(), String> {
    let row: (i64,) = sqlx::query_as("PRAGMA application_id")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to read application_id PRAGMA: {e}"))?;

    // 0x41524553 is ASCII "ARES". 0x41525553 was stamped in test builds before fixing the hex conversion.
    if row.0 != ARES_APPLICATION_ID && row.0 != 0x41525553 {
        return Err(format!(
            "Invalid project file format: application_id mismatch (expected 0x{:X}, got 0x{:X})",
            ARES_APPLICATION_ID, row.0
        ));
    }

    // Auto-fix legacy test files
    if row.0 == 0x41525553 {
        let _ = sqlx::query("PRAGMA application_id = 0x41524553").execute(pool).await;
    }

    Ok(())
}

pub struct DbState(RwLock<Option<(String, SqlitePool)>>);

impl DbState {
    pub fn new() -> Self {
        Self(RwLock::new(None))
    }

    pub async fn set(&self, id: String, pool: SqlitePool) {
        let mut guard = self.0.write().await;
        if let Some((_, old)) = guard.take() {
            old.close().await;
        }
        *guard = Some((id, pool));
    }

    pub async fn close(&self) {
        let mut guard = self.0.write().await;
        if let Some((_, old)) = guard.take() {
            old.close().await;
        }
    }

    pub async fn get_active_id(&self) -> Option<String> {
        self.0.read().await.as_ref().map(|(id, _)| id.clone())
    }

    pub async fn pool(&self) -> Result<SqlitePool, String> {
        self.0
            .read()
            .await
            .as_ref()
            .map(|(_, pool)| pool.clone())
            .ok_or_else(|| "no project open".into())
    }
}

pub enum DatabaseType {
    Catalog,
    Project,
}

pub async fn open_project_db(
    path: &std::path::Path,
    database_type: DatabaseType,
) -> anyhow::Result<sqlx::SqlitePool> {
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;

    match database_type {
        DatabaseType::Catalog => {
            sqlx::migrate!("./migrations/catalog").run(&pool).await?;
        }

        DatabaseType::Project => {
            sqlx::migrate!("./migrations/project").run(&pool).await?;
        }
    }

    Ok(pool)
}
