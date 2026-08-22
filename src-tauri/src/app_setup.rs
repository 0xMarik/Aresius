use tauri::Manager;

use crate::ares_utils::database::projects_catalog::{catalog_db_path, CatalogState};
use crate::ares_utils::database::{open_project_db, DatabaseType};
use crate::ares_utils::shutdown_gracefully;

#[tauri::command]
pub async fn close_splashscreen(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Open the catalog DB synchronously so it is available before any command or background service runs.
    let handle = app.handle().clone();
    let pool = tauri::async_runtime::block_on(async {
        let path = catalog_db_path(&handle).unwrap();
        open_project_db(&path, DatabaseType::Catalog).await.unwrap()
    });
    handle.manage(CatalogState::new(pool.clone()));

    // Load persisted proxy settings and spawn the HTTP proxy service in the background.
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let settings = crate::ares_utils::database::projects_catalog::get_proxy_settings_internal(&pool)
            .await
            .unwrap_or_default();
        if let Err(e) = crate::proxy::start_proxy_service(app_handle, settings).await {
            tracing::error!("Proxy startup error: {}", e);
        }
    });

    // If splashscreen window doesn't exist, show main window directly
    if app.get_webview_window("splashscreen").is_none() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }

    // Hook into the close event for a graceful shutdown.
    if let Some(window) = app.get_webview_window("main") {
        let app_handle = app.handle().clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    shutdown_gracefully(&app_handle).await;
                    app_handle.exit(0);
                });
            }
        });
    }

    Ok(())
}
