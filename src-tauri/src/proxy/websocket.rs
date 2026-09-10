use crate::ares_utils::database::ws_history::{close_ws_stream, save_ws_message};
use crate::ares_utils::database::DbState;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsStreamCreatedPayload {
    pub id: i64,
    pub project_id: String,
    pub destination: String,
    pub path: String,
    pub is_tls: bool,
    pub created_at: i64,
    pub status: String,
    pub message_count: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsMessagePayload {
    pub id: i64,
    pub stream_id: i64,
    pub project_id: String,
    pub direction: String,
    pub message_type: String,
    pub payload: String,
    pub payload_length: i64,
    pub sent_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsStreamClosedPayload {
    pub stream_id: i64,
    pub closed_at: i64,
    pub status: String,
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Manages the full-duplex WebSocket tunnel between client and upstream server.
pub async fn handle_websocket_tunnel<C, S>(
    app: AppHandle,
    stream_id: i64,
    project_id: String,
    client_stream: C,
    server_stream: S,
) where
    C: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    tracing::info!("Starting WebSocket tunnel for stream {}", stream_id);

    let client_ws = WebSocketStream::from_raw_socket(client_stream, Role::Server, None).await;
    let server_ws = WebSocketStream::from_raw_socket(server_stream, Role::Client, None).await;

    let (mut client_write, mut client_read) = client_ws.split();
    let (mut server_write, mut server_read) = server_ws.split();

    let app_c2s = app.clone();
    let proj_c2s = project_id.clone();

    // Client -> Server task
    let c2s_handle = tokio::spawn(async move {
        while let Some(msg_res) = client_read.next().await {
            match msg_res {
                Ok(msg) => {
                    let sent_at = current_time_ms();
                    let (msg_type, payload_str, len, forward_msg) = match msg {
                        Message::Text(ref text) => (
                            "Text".to_string(),
                            text.as_str().to_string(),
                            text.as_bytes().len() as i64,
                            Some(Message::Text(text.clone())),
                        ),
                        Message::Binary(ref bin) => (
                            "Binary".to_string(),
                            base64::prelude::BASE64_STANDARD.encode(bin),
                            bin.len() as i64,
                            Some(Message::Binary(bin.clone())),
                        ),
                        Message::Ping(ref p) => (
                            "Ping".to_string(),
                            base64::prelude::BASE64_STANDARD.encode(p),
                            p.len() as i64,
                            Some(Message::Ping(p.clone())),
                        ),
                        Message::Pong(ref p) => (
                            "Pong".to_string(),
                            base64::prelude::BASE64_STANDARD.encode(p),
                            p.len() as i64,
                            Some(Message::Pong(p.clone())),
                        ),
                        Message::Close(ref c) => {
                            let close_reason = c.as_ref().map(|r| r.reason.to_string()).unwrap_or_default();
                            (
                                "Close".to_string(),
                                close_reason,
                                0,
                                Some(Message::Close(c.clone())),
                            )
                        }
                        Message::Frame(_) => continue,
                    };

                    // Persist message to database & emit event
                    let db_state: tauri::State<DbState> = app_c2s.state();
                    if let Ok(pool) = db_state.pool().await {
                        if let Ok(msg_id) = save_ws_message(
                            &pool,
                            stream_id,
                            &proj_c2s,
                            "ClientToServer",
                            &msg_type,
                            &payload_str,
                            len,
                            sent_at,
                        )
                        .await
                        {
                            app_c2s
                                .emit(
                                    "ws_message_received",
                                    WsMessagePayload {
                                        id: msg_id,
                                        stream_id,
                                        project_id: proj_c2s.clone(),
                                        direction: "ClientToServer".to_string(),
                                        message_type: msg_type.clone(),
                                        payload: payload_str.clone(),
                                        payload_length: len,
                                        sent_at,
                                    },
                                )
                                .ok();
                        }
                    }

                    if let Some(f_msg) = forward_msg {
                        let is_close = matches!(f_msg, Message::Close(_));
                        if server_write.send(f_msg).await.is_err() {
                            break;
                        }
                        if is_close {
                            break;
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!("WebSocket client read error on stream {}: {}", stream_id, e);
                    break;
                }
            }
        }
    });

    let app_s2c = app.clone();
    let proj_s2c = project_id.clone();

    // Server -> Client task
    let s2c_handle = tokio::spawn(async move {
        while let Some(msg_res) = server_read.next().await {
            match msg_res {
                Ok(msg) => {
                    let sent_at = current_time_ms();
                    let (msg_type, payload_str, len, forward_msg) = match msg {
                        Message::Text(ref text) => (
                            "Text".to_string(),
                            text.as_str().to_string(),
                            text.as_bytes().len() as i64,
                            Some(Message::Text(text.clone())),
                        ),
                        Message::Binary(ref bin) => (
                            "Binary".to_string(),
                            base64::prelude::BASE64_STANDARD.encode(bin),
                            bin.len() as i64,
                            Some(Message::Binary(bin.clone())),
                        ),
                        Message::Ping(ref p) => (
                            "Ping".to_string(),
                            base64::prelude::BASE64_STANDARD.encode(p),
                            p.len() as i64,
                            Some(Message::Ping(p.clone())),
                        ),
                        Message::Pong(ref p) => (
                            "Pong".to_string(),
                            base64::prelude::BASE64_STANDARD.encode(p),
                            p.len() as i64,
                            Some(Message::Pong(p.clone())),
                        ),
                        Message::Close(ref c) => {
                            let close_reason = c.as_ref().map(|r| r.reason.to_string()).unwrap_or_default();
                            (
                                "Close".to_string(),
                                close_reason,
                                0,
                                Some(Message::Close(c.clone())),
                            )
                        }
                        Message::Frame(_) => continue,
                    };

                    let db_state: tauri::State<DbState> = app_s2c.state();
                    if let Ok(pool) = db_state.pool().await {
                        if let Ok(msg_id) = save_ws_message(
                            &pool,
                            stream_id,
                            &proj_s2c,
                            "ServerToClient",
                            &msg_type,
                            &payload_str,
                            len,
                            sent_at,
                        )
                        .await
                        {
                            app_s2c
                                .emit(
                                    "ws_message_received",
                                    WsMessagePayload {
                                        id: msg_id,
                                        stream_id,
                                        project_id: proj_s2c.clone(),
                                        direction: "ServerToClient".to_string(),
                                        message_type: msg_type.clone(),
                                        payload: payload_str.clone(),
                                        payload_length: len,
                                        sent_at,
                                    },
                                )
                                .ok();
                        }
                    }

                    if let Some(f_msg) = forward_msg {
                        let is_close = matches!(f_msg, Message::Close(_));
                        if client_write.send(f_msg).await.is_err() {
                            break;
                        }
                        if is_close {
                            break;
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!("WebSocket server read error on stream {}: {}", stream_id, e);
                    break;
                }
            }
        }
    });

    // Wait until either direction finishes/disconnects
    tokio::select! {
        _ = c2s_handle => {},
        _ = s2c_handle => {},
    }

    let closed_at = current_time_ms();
    tracing::info!("WebSocket tunnel closed for stream {}", stream_id);

    let db_state: tauri::State<DbState> = app.state();
    if let Ok(pool) = db_state.pool().await {
        let _ = close_ws_stream(&pool, stream_id, "closed", closed_at).await;
    }

    app.emit(
        "ws_stream_closed",
        WsStreamClosedPayload {
            stream_id,
            closed_at,
            status: "closed".to_string(),
        },
    )
    .ok();
}
