// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod http_request;
use http_request::http_request;
use serde::Serialize;
use std::thread;
use tauri::AppHandle;
use tauri::Emitter;
use uuid::Uuid;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
struct AsyncResponse {
    request_id: String,
}

#[derive(Serialize, Clone)]
struct RequestCompletedPayload {
    request_id: String,
    result: Option<String>,
    error: Option<String>,
}

#[tauri::command]

fn send_data_async(content: String, app_handle: AppHandle) -> Result<AsyncResponse, String> {
    let request_id = Uuid::new_v4().to_string();
    let request_id_clone = request_id.clone();

    let app_handle_for_thread = app_handle.clone(); // ✅ clone before move into thread
                                                    // Spawn a thread to do the work
    thread::spawn(move || {
        // Do the actual work
        let result = http_request(content);

        // Prepare the response
        let payload = match result {
            Ok(success_result) => RequestCompletedPayload {
                request_id: request_id_clone,
                result: Some(success_result),
                error: None,
            },
            Err(error_msg) => RequestCompletedPayload {
                request_id: request_id_clone,
                result: None,
                error: Some(error_msg.to_string()),
            },
        };

        // Send result back to frontend
        let _ = app_handle_for_thread.emit("request-completed", payload);
    });

    // Return immediately with request ID
    Ok(AsyncResponse { request_id })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, send_data_async])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
