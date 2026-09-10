use crate::ares_utils::database::ws_history::{
    clear_ws_history as db_clear_ws_history,
    get_ws_messages as db_get_ws_messages,
    get_ws_streams as db_get_ws_streams,
    WsMessageRow, WsStreamRow,
};
use crate::ares_utils::database::DbState;
use tauri::State;

#[tauri::command]
pub async fn get_ws_streams(
    project_id: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<WsStreamRow>, String> {
    let pool = db_state.pool().await?;
    db_get_ws_streams(&pool, &project_id).await
}

#[tauri::command]
pub async fn get_ws_messages(
    stream_id: i64,
    db_state: State<'_, DbState>,
) -> Result<Vec<WsMessageRow>, String> {
    let pool = db_state.pool().await?;
    db_get_ws_messages(&pool, stream_id).await
}

#[tauri::command]
pub async fn clear_ws_history(
    project_id: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    db_clear_ws_history(&pool, &project_id).await
}

#[tauri::command]
pub async fn delete_ws_message(
    message_id: i64,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    crate::ares_utils::database::ws_history::delete_ws_message(&pool, message_id).await
}

#[tauri::command]
pub async fn clear_stream_messages(
    stream_id: i64,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let pool = db_state.pool().await?;
    crate::ares_utils::database::ws_history::delete_ws_stream_messages(&pool, stream_id).await
}
