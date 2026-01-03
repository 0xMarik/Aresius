// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ares_utils;
mod http_request;

mod fuzzer;
// src-tauri/src/main.rs
mod types;
// use tauri::http::response;
use types::*;

use types::replayer::*;

use crate::fuzzer::*;

mod proxy;
use crate::http_request::HttpConnection;
use crate::proxy::*;

// use std::collections::HashMap;

#[tauri::command]
async fn process_fuzzer_session(
    session: FuzzerSession,
    fuzzing_attack_type: FuzzingAttackType,
    num_threads: usize,
) -> Result<Vec<ReqRes>, String> {
    let results = match fuzzing_attack_type {
        FuzzingAttackType::Rotator => execute_rotator_fuzzing(&session, num_threads).await,
        FuzzingAttackType::Echo => execute_echo_fuzzing(&session, num_threads).await,
        FuzzingAttackType::Zipped => execute_zipped_fuzzing(&session, num_threads).await,
        FuzzingAttackType::Combinatorial => {
            execute_combinatorial_fuzzing(&session, num_threads).await
        }
    };

    // Return success
    Ok(results)
}

#[tauri::command]
async fn replay_request(url: String, request_tmp: String) -> Result<ReplayerResponse, String> {
    let url = url.clone();
    let req = request_tmp.clone();

    let mut conn = HttpConnection::new(&url)
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    let (response, response_time) = conn
        .send_request(&req)
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    conn.close()
        .await
        .map_err(|e| format!("Request failed to close: {e}"))?;

    Ok(ReplayerResponse {
        response_raw: response,
        response_time: response_time.as_millis(),
        request_raw: req,
    })
}

// async fn replay_request(request: ReaplayerRequest) -> ReplayerResponse {
//     let url = request.url.clone();
//     let request = request.request_tmp.clone();
//     let mut replayer_response;

//     let handler = tokio::spawn(async move {
//         let mut conn = match HttpConnection::new(&url).await {
//             Ok(conn) => conn,
//             Err(e) => {
//                 eprintln!("Connection failed: {}", e);
//                 return;
//             }
//         };

//         match conn.send_request(&request).await {
//             Ok((response, response_time)) => {
//                 replayer_response = ReplayerResponse {
//                     response_raw: response.clone(),
//                     response_time: response_time.as_millis(),
//                     request_raw: request.clone(),
//                 };
//                 // response = req_res;
//             }
//             Err(e) => eprintln!("Request failed: {}", e),
//         }
//     });

//     return replayer_response;
// }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_| {
            // let handle = app.handle();

            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_http_proxy("127.0.0.1:8080").await {
                    eprintln!("Proxy error: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            process_fuzzer_session,
            replay_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
