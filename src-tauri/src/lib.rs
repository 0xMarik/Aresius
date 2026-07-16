// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ares_utils;
mod http_request;

mod fuzzer;
// src-tauri/src/main.rs
mod types;

use tauri::Manager;
// use tauri::http::response;
use types::*;

use types::replayer::*;

use crate::fuzzer::*;

mod proxy;
use crate::http_request::HttpConnection;
use crate::proxy::*;

use tracing;

use ares_utils::certs::certification_installation::install_cert;
use ares_utils::certs::check_cert_installed::check_cert_installed;

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

async fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        splash.close().unwrap();
    }
    if let Some(main) = app.get_webview_window("main") {
        main.show().unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "aresius=debug,tauri=info".into()),
        )
        .with_target(true)
        .init();

    tracing::info!("Aresius starting up");

    tauri::Builder::default()
        .manage(InterceptState::new())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(_splash) = app.get_webview_window("splashscreen") {
                // splash.set_shadow(false).unwrap();
                // print!("Closing splashscreen...");
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = start_http_proxy(app_handle, "127.0.0.1:8080").await {
                        tracing::error!("Proxy error: {}", e);
                    }
                });

                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // thread::sleep(std::time::Duration::from_secs(10));
                    close_splashscreen(app_handle).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            process_fuzzer_session,
            replay_request,
            resolve_intercept,
            install_cert,
            check_cert_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
