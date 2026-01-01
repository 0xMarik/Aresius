// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ares_utils;
mod http_request;

mod fuzzer;
// src-tauri/src/main.rs
mod types;
use types::*;

use crate::fuzzer::*;

mod proxy;
use crate::proxy::*;

// use std::collections::HashMap;

#[tauri::command]
async fn process_fuzzer_session(
    session: FuzzerSession,
    fuzzing_attack_type: FuzzingAttackType,
    num_threads: usize,
) -> Result<Vec<ReqRes>, String> {
    println!("fuzzing attack type: {:?}", fuzzing_attack_type);

    // let results = Arc::new(Mutex::new(Vec::new()));
    // let mut handles = vec![];

    // // Create all request variants first
    // let mut requests = Vec::new();
    // for param in &session.payload.parameters {
    //     for value in &param.values {
    //         let modified_request =
    //             building_raw_request(&session.payload.raw_request, value, &param.highlight_range);
    //         requests.push(modified_request);
    //     }
    // }

    // // Split work across tasks (e.g., 5 concurrent tasks)
    // let num_tasks = 10;
    // let chunk_size = (requests.len() + num_tasks - 1) / num_tasks;

    // for chunk in requests.chunks(chunk_size) {
    //     let chunk = chunk.to_vec();
    //     let url = session.payload.metadata.target_url.clone();
    //     let results = Arc::clone(&results);

    //     let handle = tokio::spawn(async move {
    //         // Each task gets its own persistent connection
    //         let mut conn = match HttpConnection::new(&url).await {
    //             Ok(conn) => conn,
    //             Err(e) => {
    //                 eprintln!("Connection failed: {}", e);
    //                 return;
    //             }
    //         };

    //         for modified_request in chunk {
    //             match conn.send_request(&modified_request).await {
    //                 Ok((response, response_time)) => {
    //                     let req_res = ReqRes {
    //                         request: modified_request.clone(),
    //                         response: response.clone(),
    //                         response_time: response_time.as_millis(),
    //                     };

    //                     // Lock only when writing results
    //                     results.lock().await.push(req_res);

    //                     // println!("Response: {}", response);
    //                     // println!("Modified Request:\n{}", modified_request);
    //                 }
    //                 Err(e) => eprintln!("Request failed: {}", e),
    //             }
    //         }
    //     });

    //     handles.push(handle);
    // }

    // // Wait for all tasks to complete
    // for handle in handles {
    //     handle.await.unwrap();
    // }

    // // Extract results
    // let results = Arc::try_unwrap(results).unwrap().into_inner();

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // let handle = app.handle();

            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_http_proxy("127.0.0.1:8080").await {
                    eprintln!("Proxy error: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![process_fuzzer_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
