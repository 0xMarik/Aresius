pub mod body_decoder;
pub mod certs;
use url::Url;
pub mod database;
pub mod http_connection;
pub mod parse;

// ares_utils/database/mod.rs — or a new ares_utils/lifecycle.rs if you'd rather separate it

use tauri::{AppHandle, Manager};

use crate::ares_utils::database::{projects_catalog::CatalogState, DbState};

#[derive(Debug, Clone)]
pub struct UrlComponents {
    // pub protocol: String,
    pub domain: String,
    pub port: u16,
}

pub fn url_parsing(url_str: &str) -> Option<UrlComponents> {
    let parsed_url = Url::parse(url_str).ok()?;

    // Get all required components
    // let protocol = parsed_url.scheme();
    let domain = parsed_url.domain()?;
    let port = parsed_url.port_or_known_default()?; // This will fail if no port and no known default

    // If we got here, all components are present
    let components = UrlComponents {
        // protocol: protocol.to_string(),
        domain: domain.to_string(),
        port,
    };
    Some(components)
}

/// Cleanly checkpoints and closes every open SQLite connection (project + catalog)
/// before the app exits. Call this from the window's CloseRequested handler.
pub async fn shutdown_gracefully(app: &AppHandle) {
    let db = app.state::<DbState>();
    if let Ok(pool) = db.pool().await {
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
            .execute(&pool)
            .await
            .ok();
        pool.close().await;
    }

    let catalog = app.state::<CatalogState>();
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
        .execute(catalog.pool())
        .await
        .ok();
    catalog.pool().close().await;
}
