// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod http_request;
use http_request::http_request;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn send_data(content: String) -> String {
    http_request(content.clone());
    format!("Data received: {content}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, send_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
