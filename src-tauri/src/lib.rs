// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ares_utils;
use tokio::time::timeout;
mod fuzzer;
// src-tauri/src/main.rs
mod types;

use std::time::Duration;

use tauri::Manager;
// use tauri::http::response;

use types::replayer::*;

use crate::fuzzer::combinatorial::execute_combinatorial_fuzzing;
use crate::fuzzer::echo::execute_echo_fuzzing;
use crate::fuzzer::engine::{
    cancel_fuzzing, resend_failed_fuzz_requests, resend_fuzz_request, resend_worker_fuzz_requests,
};
use crate::fuzzer::rotator::execute_rotator_fuzzing;
use crate::fuzzer::zipped::execute_zipped_fuzzing;

mod proxy;
use crate::proxy::utils::HistoryIdCounter;
use crate::proxy::*;

use tracing;

use ares_utils::certs::certification_installation::install_cert;
use ares_utils::certs::check_cert_installed::check_cert_installed;
use ares_utils::http_connection::HttpConnection;

#[tauri::command]
async fn replay_request(url: String, request_tmp: String) -> Result<ReplayerResponse, String> {
    let req = request_tmp;

    let mut conn = HttpConnection::new(&url)
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    let result = conn.send_request(&req.as_bytes()).await;

    // Always attempt a clean shutdown, whether or not the request
    // succeeded. A target that's slow or hostile shouldn't be able to make
    // this hang forever, so bound it with a short timeout; either way we
    // don't let a close failure override a response we already have.
    match timeout(Duration::from_secs(5), conn.close()).await {
        Ok(Err(e)) => eprintln!("warning: failed to cleanly close connection to {url}: {e}"),
        Err(_) => eprintln!("warning: close on {url} timed out after 5s"),
        Ok(Ok(())) => {}
    }

    let response = result.map_err(|e| format!("Request failed: {e}"))?;

    Ok(ReplayerResponse {
        response_raw: response.as_text_lossy(),
        response_time: response.elapsed.as_millis(),
        request_raw: req,
    })
}

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
        .manage(CertCache::new())
        .manage(HistoryIdCounter::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Some(_splash) = app.get_webview_window("splashscreen") {
                // splash.set_shadow(false).unwrap();
                // print!("Closing splashscreen...");
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = start_http_proxy(app_handle, "0.0.0.0:8080").await {
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
            execute_rotator_fuzzing,
            execute_zipped_fuzzing,
            execute_echo_fuzzing,
            execute_combinatorial_fuzzing,
            cancel_fuzzing,
            resend_fuzz_request,
            resend_failed_fuzz_requests,
            resend_worker_fuzz_requests,
            replay_request,
            get_intercept_settings,
            set_intercept_settings,
            get_intercept_queue,
            forward_intercept_item,
            drop_intercept_item,
            drop_all_intercept_items,
            install_cert,
            check_cert_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
