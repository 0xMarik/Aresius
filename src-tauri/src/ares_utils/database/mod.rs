use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqlitePool,
};
use std::str::FromStr;
use tokio::sync::RwLock;
pub mod projects;
pub mod projects_catalog;

/// 4-byte fingerprint written into every Aresius project file.
/// Spells "ARES" in ASCII when you look at the bytes: 0x41 'A' 0x52 'R' 0x45 'E' 0x53 'S'.
pub const ARES_APPLICATION_ID: i64 = 0x41524553;

/// Call ONCE, right after a brand new file is created.
pub async fn stamp_ares_file(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("PRAGMA application_id = ?")
        .bind(ARES_APPLICATION_ID)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub struct DbState(RwLock<Option<SqlitePool>>);

impl DbState {
    pub fn new() -> Self {
        Self(RwLock::new(None))
    }

    pub async fn set(&self, pool: SqlitePool) {
        let mut guard = self.0.write().await;
        if let Some(old) = guard.take() {
            old.close().await;
        }
        *guard = Some(pool);
    }

    pub async fn pool(&self) -> Result<SqlitePool, String> {
        self.0
            .read()
            .await
            .clone()
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
