// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod http_request;
// use http_request::http_request;

mod ares_utils;
mod structs;

mod fuzzer;
// src-tauri/src/main.rs
mod types;
use types::*;

#[tauri::command]
async fn process_fuzzer_session(session: FuzzerSession) -> Result<String, String> {
    println!("Received session: {}", session.name);
    println!("Raw request: {}", session.payload.raw_request);
    println!("Target URL: {}", session.payload.metadata.target_url);

    // Process your fuzzer session here
    for param in &session.payload.parameters {
        println!(
            "Parameter from {} with {} values",
            format!("{:?}", param.payload_source),
            param.values.len()
        );
        for value in &param.values {
            println!(" - Value: {}", value);
        }
    }

    // Return success
    Ok(format!("Processed session: {}", session.name))
}

// #[tauri::command]
// fn send_data_async(
//     content: String,
//     app_handle: AppHandle,
//     url: String,
// ) -> Result<AsyncResponse, String> {
//     let request_id = Uuid::new_v4().to_string();
//     let request_id_clone = request_id.clone();

//     let app_handle_for_thread = app_handle.clone(); // ✅ clone before move into thread
//                                                     // Spawn a thread to do the work
//     thread::spawn(move || {
//         // Do the actual work
//         let result = http_request(content, url);

//         // Prepare the response
//         let payload = match result {
//             Ok(success_result) => RequestCompletedPayload {
//                 request_id: request_id_clone,
//                 result: Some(success_result),
//                 error: None,
//             },
//             Err(error_msg) => RequestCompletedPayload {
//                 request_id: request_id_clone,
//                 result: None,
//                 error: Some(error_msg.to_string()),
//             },
//         };

//         // Send result back to frontend
//         let _ = app_handle_for_thread.emit("request-completed", payload);
//     });

//     // Return immediately with request ID
//     Ok(AsyncResponse { request_id })
// }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![process_fuzzer_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
