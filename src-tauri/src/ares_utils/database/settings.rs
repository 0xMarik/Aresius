use std::path::PathBuf;
use sqlx::SqlitePool;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Settings Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    pub host: String,
    pub port: u16,
    pub auto_fallback_port: bool,
    pub auto_fallback_loopback: bool,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8080,
            auto_fallback_port: true,
            auto_fallback_loopback: true,
        }
    }
}

fn default_show_splashscreen() -> bool {
    true
}

fn default_startup_project_mode() -> String {
    "last_used".to_string()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub sidebar_collapsed: bool,
    pub active_project_id: Option<String>,
    pub last_page: String,
    pub font_size_scale: Option<f64>,
    #[serde(default = "default_show_splashscreen")]
    pub show_splashscreen: bool,
    #[serde(default = "default_startup_project_mode")]
    pub startup_project_mode: String,
    pub startup_project_specific_id: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sidebar_collapsed: false,
            active_project_id: None,
            last_page: "/projects".to_string(),
            font_size_scale: None,
            show_splashscreen: true,
            startup_project_mode: "last_used".to_string(),
            startup_project_specific_id: None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzerSettings {
    pub show_uncompleted_requests: bool,
}

impl Default for FuzzerSettings {
    fn default() -> Self {
        Self {
            show_uncompleted_requests: false,
        }
    }
}

// ---------------------------------------------------------------------------
// SettingsState managed state wrapper
// ---------------------------------------------------------------------------

pub struct SettingsState(SqlitePool);

impl SettingsState {
    pub fn new(pool: SqlitePool) -> Self {
        Self(pool)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.0
    }
}

// ---------------------------------------------------------------------------
// Path Helper
// ---------------------------------------------------------------------------

pub fn settings_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let database_dir = dir.join("database");
    std::fs::create_dir_all(&database_dir).map_err(|e| e.to_string())?;
    Ok(database_dir.join("settings.db"))
}

// ---------------------------------------------------------------------------
// Internal Helper Functions
// ---------------------------------------------------------------------------

pub async fn get_proxy_settings_internal(pool: &SqlitePool) -> Result<ProxySettings, String> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT key, value FROM global_settings WHERE key IN ('proxy_host', 'proxy_port', 'proxy_auto_fallback_port', 'proxy_auto_fallback_loopback')"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut settings = ProxySettings::default();

    for (key, value) in rows {
        if let Some(val) = value {
            match key.as_str() {
                "proxy_host" => {
                    let trimmed = val.trim();
                    if !trimmed.is_empty() {
                        settings.host = trimmed.to_string();
                    }
                }
                "proxy_port" => {
                    if let Ok(p) = val.parse::<u16>() {
                        if p > 0 {
                            settings.port = p;
                        }
                    }
                }
                "proxy_auto_fallback_port" => {
                    settings.auto_fallback_port = val == "true";
                }
                "proxy_auto_fallback_loopback" => {
                    settings.auto_fallback_loopback = val == "true";
                }
                _ => {}
            }
        }
    }

    Ok(settings)
}

pub async fn save_proxy_settings_internal(pool: &SqlitePool, settings: &ProxySettings) -> Result<(), String> {
    let host_val = settings.host.trim();
    let port_val = settings.port.to_string();
    let fallback_port_val = if settings.auto_fallback_port { "true" } else { "false" };
    let fallback_loopback_val = if settings.auto_fallback_loopback { "true" } else { "false" };

    sqlx::query("INSERT INTO global_settings (key, value) VALUES ('proxy_host', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(host_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO global_settings (key, value) VALUES ('proxy_port', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(port_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO global_settings (key, value) VALUES ('proxy_auto_fallback_port', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(fallback_port_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO global_settings (key, value) VALUES ('proxy_auto_fallback_loopback', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(fallback_loopback_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn get_fuzzer_settings_internal(pool: &SqlitePool) -> Result<FuzzerSettings, String> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT value FROM global_settings WHERE key = 'fuzzer_show_uncompleted_requests'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut settings = FuzzerSettings::default();
    if let Some((Some(val),)) = row {
        settings.show_uncompleted_requests = val == "true";
    }

    Ok(settings)
}

pub async fn save_fuzzer_settings_internal(pool: &SqlitePool, settings: &FuzzerSettings) -> Result<(), String> {
    let val = if settings.show_uncompleted_requests { "true" } else { "false" };

    sqlx::query("INSERT INTO global_settings (key, value) VALUES ('fuzzer_show_uncompleted_requests', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn get_app_state_internal(pool: &SqlitePool) -> Result<AppState, String> {
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT key, value FROM global_settings WHERE key IN ('sidebar_collapsed', 'active_project_id', 'last_page', 'font_size_scale', 'show_splashscreen', 'startup_project_mode', 'startup_project_specific_id')")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    let mut sidebar_collapsed = false;
    let mut active_project_id: Option<String> = None;
    let mut last_page = "/projects".to_string();
    let mut font_size_scale: Option<f64> = None;
    let mut show_splashscreen = true;
    let mut startup_project_mode = "last_used".to_string();
    let mut startup_project_specific_id: Option<String> = None;

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
            "show_splashscreen" => {
                if let Some(v) = value {
                    show_splashscreen = v != "false";
                }
            }
            "startup_project_mode" => {
                if let Some(v) = value {
                    if !v.is_empty() {
                        startup_project_mode = v;
                    }
                }
            }
            "startup_project_specific_id" => {
                startup_project_specific_id = value.filter(|v| !v.is_empty());
            }
            _ => {}
        }
    }

    Ok(AppState {
        sidebar_collapsed,
        active_project_id,
        last_page,
        font_size_scale,
        show_splashscreen,
        startup_project_mode,
        startup_project_specific_id,
    })
}

pub async fn save_app_state_internal(pool: &SqlitePool, state: &AppState) -> Result<(), String> {
    let sidebar_val = if state.sidebar_collapsed { "true" } else { "false" };

    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("sidebar_collapsed")
    .bind(sidebar_val)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("active_project_id")
    .bind(&state.active_project_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("last_page")
    .bind(&state.last_page)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(scale) = state.font_size_scale {
        sqlx::query(
            "INSERT INTO global_settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind("font_size_scale")
        .bind(scale.to_string())
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    let splash_val = if state.show_splashscreen { "true" } else { "false" };
    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("show_splashscreen")
    .bind(splash_val)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("startup_project_mode")
    .bind(&state.startup_project_mode)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("startup_project_specific_id")
    .bind(&state.startup_project_specific_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn set_show_splashscreen_internal(pool: &SqlitePool, show: bool) -> Result<(), String> {
    let val = if show { "true" } else { "false" };
    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES ('show_splashscreen', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(val)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn set_startup_project_mode_internal(
    pool: &SqlitePool,
    mode: &str,
    specific_id: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES ('startup_project_mode', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(mode)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES ('startup_project_specific_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(specific_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_app_state(
    state: tauri::State<'_, SettingsState>,
) -> Result<AppState, String> {
    get_app_state_internal(state.pool()).await
}

#[tauri::command]
pub async fn save_app_state(
    state: AppState,
    settings_state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    save_app_state_internal(settings_state.pool(), &state).await
}

#[tauri::command]
pub async fn set_show_splashscreen(
    show: bool,
    settings_state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    set_show_splashscreen_internal(settings_state.pool(), show).await
}

#[tauri::command]
pub async fn set_startup_project_mode(
    mode: String,
    specific_id: Option<String>,
    settings_state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    set_startup_project_mode_internal(settings_state.pool(), &mode, specific_id.as_deref()).await
}

#[tauri::command]
pub async fn get_proxy_settings_db(
    state: tauri::State<'_, SettingsState>,
) -> Result<ProxySettings, String> {
    get_proxy_settings_internal(state.pool()).await
}

#[tauri::command]
pub async fn save_proxy_settings_db(
    settings: ProxySettings,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    save_proxy_settings_internal(state.pool(), &settings).await
}

#[tauri::command]
pub async fn get_fuzzer_settings_db(
    state: tauri::State<'_, SettingsState>,
) -> Result<FuzzerSettings, String> {
    get_fuzzer_settings_internal(state.pool()).await
}

#[tauri::command]
pub async fn save_fuzzer_settings_db(
    settings: FuzzerSettings,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    save_fuzzer_settings_internal(state.pool(), &settings).await
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportedSettingsBundle {
    pub proxy: ProxySettings,
    pub fuzzer: FuzzerSettings,
}

#[tauri::command]
pub async fn export_settings(
    state: tauri::State<'_, SettingsState>,
) -> Result<String, String> {
    let proxy = get_proxy_settings_internal(state.pool()).await?;
    let fuzzer = get_fuzzer_settings_internal(state.pool()).await?;
    let bundle = ExportedSettingsBundle { proxy, fuzzer };
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_settings(
    json_data: String,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    let bundle: ExportedSettingsBundle = serde_json::from_str(&json_data).map_err(|e| e.to_string())?;
    save_proxy_settings_internal(state.pool(), &bundle.proxy).await?;
    save_fuzzer_settings_internal(state.pool(), &bundle.fuzzer).await?;
    Ok(())
}
