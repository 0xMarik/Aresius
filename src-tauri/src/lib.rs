// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod http_request;
// use http_request::http_request;

mod ares_utils;
mod structs;
use structs::FuzzerPayload;

use serde::Serialize;
use std::thread;

mod fuzzer;
use fuzzer::fuzzing;

use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use uuid::Uuid;

#[tauri::command]
fn greet(content: FuzzerPayload, session_index: u32, app_handle: AppHandle) {
    // let FuzzerPayload {
    //     raw_request,
    //     metadata,
    //     parameters,
    // } = content;

    // println!(
    //     "{raw_request},{:?}, {:?}, {session_index}",
    //     metadata, parameters
    // );

    fuzzing(content);

    // for i in 0..5 {
    //     let app_handle = app_handle.clone();
    //     let id = Uuid::new_v4().to_string();
    //     let index = i;

    //     thread::spawn(move || {
    //         let sleep_time = Duration::from_secs(2 + index); // Simulate different durations
    //         thread::sleep(sleep_time);

    //         let result = TaskResult {
    //             id,
    //             message: format!("Thread {} finished after {:?}!", i, sleep_time),
    //         };

    //         let _ = app_handle.emit("greet-finished", result).unwrap();
    //     });
    // }
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
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
