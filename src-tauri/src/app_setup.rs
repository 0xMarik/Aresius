use tauri::Manager;

use crate::ares_utils::database::projects_catalog::{catalog_db_path, CatalogState};
use crate::ares_utils::database::settings::{
    get_app_state_internal, get_proxy_settings_internal, settings_db_path, SettingsState,
};
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
    // Open the catalog DB and settings DB synchronously so they are available before any command or background service runs.
    let handle = app.handle().clone();
    let (catalog_pool, settings_pool) = tauri::async_runtime::block_on(async {
        let cat_path = catalog_db_path(&handle).unwrap();
        let cat_pool = open_project_db(&cat_path, DatabaseType::Catalog).await.unwrap();

        let set_path = settings_db_path(&handle).unwrap();
        let set_pool = open_project_db(&set_path, DatabaseType::Settings).await.unwrap();

        (cat_pool, set_pool)
    });
    handle.manage(CatalogState::new(catalog_pool));
    handle.manage(SettingsState::new(settings_pool.clone()));

    // Load persisted proxy settings from settings DB and spawn the HTTP proxy service in the background.
    let app_handle = app.handle().clone();
    let proxy_settings_pool = settings_pool.clone();
    tauri::async_runtime::spawn(async move {
        let settings = get_proxy_settings_internal(&proxy_settings_pool)
            .await
            .unwrap_or_default();
        if let Err(e) = crate::proxy::start_proxy_service(app_handle, settings).await {
            tracing::error!("Proxy startup error: {}", e);
        }
    });

    // Check splashscreen preference
    let app_state = tauri::async_runtime::block_on(async {
        get_app_state_internal(&settings_pool)
            .await
            .unwrap_or_default()
    });

    if app_state.show_splashscreen {
        let splash_res = tauri::WebviewWindowBuilder::new(
            app,
            "splashscreen",
            tauri::WebviewUrl::App("splashscreen.html".into()),
        )
        .title("")
        .inner_size(900.0, 600.0)
        .transparent(true)
        .always_on_top(true)
        .center()
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(false)
        .visible(true)
        .build();

        if let Err(e) = splash_res {
            tracing::error!("Failed to build splashscreen window: {}", e);
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }
    } else {
        // When splashscreen is disabled, never create or open splashscreen window!
        // Directly show the main window.
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
