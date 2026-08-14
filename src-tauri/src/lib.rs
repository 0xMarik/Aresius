mod ares_utils;
mod app_setup;
mod commands;
mod fuzzer;
mod proxy;
mod types;

use crate::ares_utils::certs::certification_installation::install_cert;
use crate::ares_utils::certs::check_cert_installed::check_cert_installed;
use crate::ares_utils::database::http_history::get_http_history;
use crate::ares_utils::database::projects::create_project;
use crate::ares_utils::database::projects_catalog::{
    delete_project, get_default_project_dir, list_projects, select_project,
};
use crate::ares_utils::database::DbState;
use crate::commands::replay_request;
use crate::fuzzer::combinatorial::execute_combinatorial_fuzzing;
use crate::fuzzer::echo::execute_echo_fuzzing;
use crate::fuzzer::engine::{
    cancel_fuzzing, get_fuzzer_history_window, get_fuzzer_request_by_id,
    resend_failed_fuzz_requests, resend_fuzz_request, resend_worker_fuzz_requests,
};
use crate::fuzzer::rotator::execute_rotator_fuzzing;
use crate::fuzzer::zipped::execute_zipped_fuzzing;
use crate::proxy::utils::HistoryIdCounter;
use crate::proxy::{CertCache, InterceptState};
use crate::proxy::{
    drop_all_intercept_items, drop_intercept_item, forward_intercept_item, get_intercept_queue,
    get_intercept_settings, set_intercept_settings,
};

use crate::ares_utils::database::replayer::{
    add_replayer_history_entry, create_replayer_collection, create_replayer_session,
    delete_replayer_collection, delete_replayer_session, get_replayer_data,
    rename_replayer_collection, rename_replayer_session, set_replayer_active_selection,
    set_replayer_collection_expanded, set_replayer_expanded_ids, update_replayer_session_draft,
};

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
        .manage(DbState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(app_setup::setup)
        .invoke_handler(tauri::generate_handler![
            // Fuzzer
            execute_rotator_fuzzing,
            execute_zipped_fuzzing,
            execute_echo_fuzzing,
            execute_combinatorial_fuzzing,
            cancel_fuzzing,
            resend_fuzz_request,
            resend_failed_fuzz_requests,
            resend_worker_fuzz_requests,
            get_fuzzer_history_window,
            get_fuzzer_request_by_id,
            // Replayer
            replay_request,
            get_replayer_data,
            create_replayer_collection,
            rename_replayer_collection,
            delete_replayer_collection,
            set_replayer_collection_expanded,
            set_replayer_expanded_ids,
            set_replayer_active_selection,
            create_replayer_session,
            rename_replayer_session,
            update_replayer_session_draft,
            delete_replayer_session,
            add_replayer_history_entry,
            // Interceptor
            get_intercept_settings,
            set_intercept_settings,
            get_intercept_queue,
            forward_intercept_item,
            drop_intercept_item,
            drop_all_intercept_items,
            // Certificates
            install_cert,
            check_cert_installed,
            // Projects
            create_project,
            list_projects,
            select_project,
            delete_project,
            get_default_project_dir,
            // HTTP History
            get_http_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
