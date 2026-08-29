mod ares_utils;
mod app_setup;
mod commands;
mod fuzzer;
mod proxy;
mod types;

use crate::app_setup::close_splashscreen;
use crate::ares_utils::certs::certification_installation::{install_cert, uninstall_cert};
use crate::ares_utils::certs::check_cert_installed::check_cert_installed;
use crate::ares_utils::certs::{
    get_ca_cert_path, get_ca_cert_pem, import_custom_cert_p12, import_custom_cert_pem,
    open_cert_manager, regenerate_ca_cert,
};
use crate::ares_utils::database::http_history::{
    delete_http_history_items, evaluate_httpql_sandbox, get_http_history, get_http_history_item,
    get_http_history_state_db, get_http_history_summaries, get_http_history_window,
    save_http_history_state_db, validate_httpql,
};
use crate::ares_utils::database::projects::create_project;
use crate::ares_utils::database::projects_catalog::{
    delete_project, get_app_state, get_default_project_dir, get_proxy_settings_db, list_projects,
    open_project_file, relocate_project, save_app_state, save_proxy_settings_db, select_project,
    update_project_details,
};
use crate::ares_utils::database::DbState;
use crate::commands::{cancel_replayer_request, replay_request};
use crate::fuzzer::combinatorial::execute_combinatorial_fuzzing;
use crate::fuzzer::echo::execute_echo_fuzzing;
use crate::fuzzer::engine::{
    cancel_fuzzing, get_fuzzer_history_window, get_fuzzer_request_by_id,
    resend_failed_fuzz_requests, resend_fuzz_request, stream_fuzzer_search,
};
use crate::ares_utils::database::fuzzer::{
    create_fuzzer_session_db, delete_fuzzer_history_db, delete_fuzzer_session_db,
    get_fuzzer_project_data, save_fuzzer_parameters_db, save_fuzzer_session_draft,
    set_fuzzer_expanded_ids, set_fuzzer_session_selection,
};
use crate::fuzzer::rotator::execute_rotator_fuzzing;
use crate::fuzzer::zipped::execute_zipped_fuzzing;
use crate::proxy::utils::HistoryIdCounter;
use crate::proxy::{CertCache, InterceptState, ProxyManager};
use crate::proxy::{
    drop_all_intercept_items, drop_intercept_item, forward_intercept_item, get_intercept_queue,
    get_intercept_settings, get_proxy_status, restart_proxy_listener,
    save_and_apply_proxy_settings, set_intercept_settings,
};

use crate::ares_utils::database::replayer::{
    add_replayer_history_entry, create_replayer_collection, create_replayer_session,
    delete_replayer_collection, delete_replayer_session, get_replayer_data,
    rename_replayer_collection, rename_replayer_session, set_replayer_active_selection,
    set_replayer_collection_expanded, set_replayer_expanded_ids, update_replayer_session_draft,
};

use crate::ares_utils::database::scope::{
    add_scope_rule_db, batch_import_scope_rules_db, create_scope_db, delete_scope_db,
    get_interceptor_settings_db, get_scope_project_data, remove_scope_rule_db, rename_scope_db,
    save_interceptor_settings_db, set_active_scope_db, set_scope_color_db,
};

use crate::proxy::MatchReplaceEngine;
use crate::commands::match_replace::{
    delete_match_replace_collection, delete_match_replace_rule, get_match_replace,
    save_match_replace_collection, save_match_replace_rule, sync_match_replace_engine,
    toggle_match_replace_rule,
};
use crate::ares_utils::database::sitemap::{get_sitemap_state_db, save_sitemap_state_db};
use crate::ares_utils::database::preset_filters::{
    delete_preset_filter_db, get_preset_filters_db, reset_default_preset_filters_db,
    save_preset_filter_db, sync_interception_filters_db, toggle_preset_filter_interception_db,
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
        .manage(MatchReplaceEngine::new())
        .manage(ProxyManager::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(app_setup::setup)
        .invoke_handler(tauri::generate_handler![
            close_splashscreen,
            // Proxy & Settings
            get_proxy_settings_db,
            save_proxy_settings_db,
            get_proxy_status,
            restart_proxy_listener,
            save_and_apply_proxy_settings,
            // Match & Replace
            get_match_replace,
            save_match_replace_rule,
            toggle_match_replace_rule,
            delete_match_replace_rule,
            save_match_replace_collection,
            delete_match_replace_collection,
            sync_match_replace_engine,
            // Fuzzer
            execute_rotator_fuzzing,
            execute_zipped_fuzzing,
            execute_echo_fuzzing,
            execute_combinatorial_fuzzing,
            cancel_fuzzing,
            resend_fuzz_request,
            resend_failed_fuzz_requests,
            get_fuzzer_history_window,
            get_fuzzer_request_by_id,
            stream_fuzzer_search,
            get_fuzzer_project_data,
            set_fuzzer_session_selection,
            set_fuzzer_expanded_ids,
            create_fuzzer_session_db,
            delete_fuzzer_session_db,
            delete_fuzzer_history_db,
            save_fuzzer_session_draft,
            save_fuzzer_parameters_db,
            // Replayer
            replay_request,
            cancel_replayer_request,
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
            get_interceptor_settings_db,
            save_interceptor_settings_db,
            // Certificates
            install_cert,
            uninstall_cert,
            check_cert_installed,
            open_cert_manager,
            regenerate_ca_cert,
            get_ca_cert_path,
            get_ca_cert_pem,
            import_custom_cert_pem,
            import_custom_cert_p12,
            // Projects
            create_project,
            list_projects,
            select_project,
            open_project_file,
            relocate_project,
            update_project_details,
            delete_project,
            get_default_project_dir,
            get_app_state,
            save_app_state,
            // HTTP History
            get_http_history,
            get_http_history_window,
            get_http_history_item,
            get_http_history_summaries,
            delete_http_history_items,
            validate_httpql,
            evaluate_httpql_sandbox,
            get_http_history_state_db,
            save_http_history_state_db,
            // Scopes
            get_scope_project_data,
            create_scope_db,
            delete_scope_db,
            rename_scope_db,
            set_scope_color_db,
            set_active_scope_db,
            add_scope_rule_db,
            remove_scope_rule_db,
            batch_import_scope_rules_db,
            // Sitemap
            get_sitemap_state_db,
            save_sitemap_state_db,
            // Preset Filters
            get_preset_filters_db,
            save_preset_filter_db,
            delete_preset_filter_db,
            reset_default_preset_filters_db,
            toggle_preset_filter_interception_db,
            sync_interception_filters_db,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
