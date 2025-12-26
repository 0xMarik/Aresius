// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod http_request;
use http_request::http_request;

mod ares_utils;
mod structs;

mod fuzzer;
// src-tauri/src/main.rs
mod types;
use types::*;

// use std::collections::HashMap;

// use std::thread;

use crate::fuzzer::building_raw_request;

#[tauri::command]
async fn process_fuzzer_session(session: FuzzerSession) -> Result<Vec<ReqRes>, String> {
    println!("Received session: {}", session.name);
    println!("Raw request: {}", session.payload.raw_request);
    println!("Target URL: {}", session.payload.metadata.target_url);
    // println!(" {}", session.payload.parameters[0].highlight_range.id);

    // Process your fuzzer session here
    for param in &session.payload.parameters {
        println!(
            "Parameter from {} with {} values",
            format!("{:?}", param.payload_source),
            param.values.len()
        );
        println!("{}", param.highlight_range.id);
        for value in &param.values {
            println!(" - Value: {}", value);
        }
    }

    // let response = http_request(
    //     "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n",
    //     "http://google.com:80",
    // )
    // .map_err(|e| format!("HTTP request failed: {}", e))?;

    // println!("Response: {}", response);

    let mut results = Vec::new();

    for param in &session.payload.parameters {
        for value in &param.values {
            let modified_request =
                building_raw_request(&session.payload.raw_request, value, &param.highlight_range);
            let response = http_request(&modified_request, &session.payload.metadata.target_url)
                .map_err(|e| format!("HTTP request failed: {}", e))?;

            results.push(ReqRes {
                request: modified_request.clone(),
                response: response.clone(),
            });
            println!("Response: {}", response);
            println!("Modified Request:\n{}", modified_request);
        }
    }

    // Return success
    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![process_fuzzer_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
