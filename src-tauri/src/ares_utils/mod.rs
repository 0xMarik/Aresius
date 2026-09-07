pub mod body_decoder;
pub mod certs;
use url::Url;
pub mod database;
pub mod http_connection;
pub mod httpql;
pub mod parse;
pub mod content_filter;
pub mod logger;

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
    let trimmed = url_str.trim();
    if trimmed.is_empty() {
        return None;
    }

    let url_to_parse = if !trimmed.contains("://") {
        format!("https://{}", trimmed)
    } else {
        trimmed.to_string()
    };
    let parsed_url = Url::parse(&url_to_parse).ok()?;

    // Get all required components (supports domain names, IPv4, IPv6, localhost)
    let domain = parsed_url.host_str()?.to_string();
    let port = parsed_url.port_or_known_default()?; // Will resolve 443 for https, 80 for http, or custom port

    let components = UrlComponents {
        domain,
        port,
    };
    Some(components)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_parsing() {
        assert_eq!(url_parsing("example.com").unwrap().port, 443);
        assert_eq!(url_parsing("example.com:8080").unwrap().port, 8080);
        assert_eq!(url_parsing("http://example.com").unwrap().port, 80);
        assert_eq!(url_parsing("https://example.com").unwrap().port, 443);
        assert_eq!(url_parsing("127.0.0.1").unwrap().domain, "127.0.0.1");
    }
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
