// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod http_request;
use http_request::http_request;
// use std::thread;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn send_data(content: String) -> String {
    match http_request(content.clone()) {
        Ok(response) => {
            println!("Success! Response:\n{}", response);
            format!("Data sent successfully: {}", response)
        }
        Err(e) => {
            eprintln!("An error occurred: {}", e);
            format!("Failed to send data: {}", content)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, send_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
