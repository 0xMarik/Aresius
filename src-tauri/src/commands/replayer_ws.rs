use std::collections::HashMap;
use std::sync::Arc;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::handshake::client::{generate_key, Request};
use tokio_tungstenite::tungstenite::Message;
use url::Url;

use crate::ares_utils::database::replayer::{
    save_replayer_ws_message_record, update_replayer_history_status,
};
use crate::ares_utils::database::DbState;
use crate::ares_utils::http_connection::HttpConnection;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerWsConnectedPayload {
    pub session_id: String,
    pub history_id: String,
    pub base_url: String,
    pub request_raw: String,
    pub response_raw: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerWsMessagePayload {
    pub session_id: String,
    pub history_id: String,
    pub id: i64,
    pub direction: String,
    pub message_type: String,
    pub payload: String,
    pub payload_length: i64,
    pub sent_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayerWsClosedPayload {
    pub session_id: String,
    pub history_id: String,
    pub status: String,
    pub error_message: Option<String>,
}

struct WsSessionHandle {
    history_id: String,
    tx: UnboundedSender<Message>,
    abort_handle: tokio::task::AbortHandle,
}

static WS_REPLAYER_SESSIONS: LazyLock<Arc<Mutex<HashMap<String, WsSessionHandle>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn normalize_ws_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    let with_scheme = if !trimmed.contains("://") {
        format!("wss://{}", trimmed)
    } else {
        trimmed.to_string()
    };

    if !with_scheme.starts_with("ws://") && !with_scheme.starts_with("wss://") {
        return Err("WebSocket URL must start with wss:// or ws://".to_string());
    }

    Ok(with_scheme)
}

fn build_client_request(
    target_url: &str,
    raw_custom_request: Option<&str>,
) -> Result<(Request, String), String> {
    let parsed_url = Url::parse(target_url).map_err(|e| format!("Invalid URL: {e}"))?;
    let host = parsed_url
        .host_str()
        .ok_or_else(|| "URL must have a host".to_string())?;
    let port = parsed_url.port_or_known_default().unwrap_or(443);
    let host_header = if (parsed_url.scheme() == "wss" && port == 443)
        || (parsed_url.scheme() == "ws" && port == 80)
    {
        host.to_string()
    } else {
        format!("{}:{}", host, port)
    };

    let path_and_query = match parsed_url.query() {
        Some(q) => format!("{}?{}", parsed_url.path(), q),
        None => {
            if parsed_url.path().is_empty() {
                "/".to_string()
            } else {
                parsed_url.path().to_string()
            }
        }
    };

    let mut builder = Request::builder()
        .uri(target_url)
        .header("Host", &host_header)
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Version", "13");

    let mut custom_ws_key: Option<String> = None;

    // If user provided custom headers in raw_custom_request, parse them
    if let Some(custom) = raw_custom_request {
        let lines: Vec<&str> = custom.lines().collect();
        for line in lines {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(colon) = line.find(':') {
                let key = line[..colon].trim();
                let val = line[colon + 1..].trim();
                let key_lower = key.to_lowercase();
                if key_lower == "sec-websocket-key" {
                    if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(val) {
                        if decoded.len() == 16 {
                            custom_ws_key = Some(val.to_string());
                        }
                    }
                } else if key_lower != "host"
                    && key_lower != "upgrade"
                    && key_lower != "connection"
                    && key_lower != "sec-websocket-version"
                {
                    builder = builder.header(key, val);
                }
            }
        }
    }

    let ws_key = custom_ws_key.unwrap_or_else(generate_key);
    builder = builder.header("Sec-WebSocket-Key", ws_key);

    let req = builder
        .body(())
        .map_err(|e| format!("Failed to build WebSocket handshake request: {e}"))?;

    // Create printable raw request representation
    let mut raw_str = format!("GET {} HTTP/1.1\r\n", path_and_query);
    for (k, v) in req.headers() {
        if let Ok(v_str) = v.to_str() {
            raw_str.push_str(&format!("{}: {}\r\n", k.as_str(), v_str));
        }
    }
    raw_str.push_str("\r\n");

    Ok((req, raw_str))
}

#[tauri::command]
pub async fn connect_replayer_ws(
    app: AppHandle,
    db: State<'_, DbState>,
    session_id: String,
    url: String,
    request_raw: Option<String>,
) -> Result<ReplayerWsConnectedPayload, String> {
    // 1. Clean up any existing connection for this session
    {
        let mut map = WS_REPLAYER_SESSIONS.lock().await;
        if let Some(old_handle) = map.remove(&session_id) {
            let _ = old_handle.tx.send(Message::Close(None));
            old_handle.abort_handle.abort();
        }
    }

    // 2. Validate URL and build handshake request
    let normalized_url = normalize_ws_url(&url)?;
    let (req, generated_req_raw) = build_client_request(&normalized_url, request_raw.as_deref())?;

    // 3. Establish TCP/TLS connection
    let http_conn = HttpConnection::new(&normalized_url)
        .await
        .map_err(|e| format!("TCP/TLS Connection failed: {e}"))?;

    let raw_connection = http_conn.into_connection();

    // 4. Perform WebSocket client handshake
    let (ws_stream, response) = tokio_tungstenite::client_async(req, raw_connection)
        .await
        .map_err(|e| format!("WebSocket handshake failed: {e}"))?;

    // Format response raw headers
    let status_code = response.status().as_u16();
    let status_line = format!("HTTP/1.1 {} {}\r\n", status_code, response.status().canonical_reason().unwrap_or("Switching Protocols"));
    let mut response_raw = status_line;
    for (k, v) in response.headers() {
        if let Ok(v_str) = v.to_str() {
            response_raw.push_str(&format!("{}: {}\r\n", k.as_str(), v_str));
        }
    }
    response_raw.push_str("\r\n");

    let history_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let pool = db.pool().await.map_err(|e| e.to_string())?;

    // Save history entry in replayer_history
    sqlx::query(
        r#"
        INSERT INTO replayer_history (id, session_id, request_raw, response_raw, response_time, created_at, sort_order, status, error_message, base_url)
        VALUES (?, ?, ?, ?, 0, ?, 0, ?, NULL, ?)
        "#
    )
    .bind(&history_id)
    .bind(&session_id)
    .bind(&generated_req_raw)
    .bind(&response_raw)
    .bind(&created_at)
    .bind("101 Switching Protocols")
    .bind(&normalized_url)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to record history entry: {e}"))?;

    let (mut ws_sink, mut ws_stream_read) = ws_stream.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    let history_id_clone = history_id.clone();
    let session_id_clone = session_id.clone();
    let app_clone = app.clone();
    let pool_clone = pool.clone();

    // 5. Spawn background processing loop
    let join_handle = tokio::spawn(async move {
        let mut close_status = "Closed".to_string();
        let mut close_error: Option<String> = None;

        loop {
            tokio::select! {
                // Outgoing frames from UI
                outgoing = rx.recv() => {
                    match outgoing {
                        Some(msg) => {
                            let is_close = matches!(msg, Message::Close(_));
                            if let Err(e) = ws_sink.send(msg).await {
                                eprintln!("Error sending WebSocket frame: {e}");
                                close_status = "Error".to_string();
                                close_error = Some(e.to_string());
                                break;
                            }
                            if is_close {
                                break;
                            }
                        }
                        None => break,
                    }
                }

                // Incoming frames from Server
                incoming = ws_stream_read.next() => {
                    match incoming {
                        Some(Ok(msg)) => {
                            let now = current_time_ms();
                            match msg {
                                Message::Text(txt) => {
                                    let payload = txt.as_str().to_string();
                                    let payload_len = payload.len() as i64;
                                    let msg_id = save_replayer_ws_message_record(
                                        &pool_clone,
                                        &history_id_clone,
                                        "ServerToClient",
                                        "Text",
                                        &payload,
                                        payload_len,
                                        now,
                                    )
                                    .await
                                    .unwrap_or(0);

                                    let _ = app_clone.emit(
                                        "replayer_ws_message",
                                        ReplayerWsMessagePayload {
                                            session_id: session_id_clone.clone(),
                                            history_id: history_id_clone.clone(),
                                            id: msg_id,
                                            direction: "ServerToClient".to_string(),
                                            message_type: "Text".to_string(),
                                            payload,
                                            payload_length: payload_len,
                                            sent_at: now,
                                        },
                                    );
                                }
                                Message::Binary(bin) => {
                                    let payload = base64::engine::general_purpose::STANDARD.encode(&bin);
                                    let payload_len = bin.len() as i64;
                                    let msg_id = save_replayer_ws_message_record(
                                        &pool_clone,
                                        &history_id_clone,
                                        "ServerToClient",
                                        "Binary",
                                        &payload,
                                        payload_len,
                                        now,
                                    )
                                    .await
                                    .unwrap_or(0);

                                    let _ = app_clone.emit(
                                        "replayer_ws_message",
                                        ReplayerWsMessagePayload {
                                            session_id: session_id_clone.clone(),
                                            history_id: history_id_clone.clone(),
                                            id: msg_id,
                                            direction: "ServerToClient".to_string(),
                                            message_type: "Binary".to_string(),
                                            payload,
                                            payload_length: payload_len,
                                            sent_at: now,
                                        },
                                    );
                                }
                                Message::Close(frame) => {
                                    if let Some(cf) = frame {
                                        close_status = format!("Closed ({})", cf.code);
                                    } else {
                                        close_status = "Closed".to_string();
                                    }
                                    break;
                                }
                                Message::Ping(data) => {
                                    let _ = ws_sink.send(Message::Pong(data)).await;
                                }
                                Message::Pong(_) => {}
                                _ => {}
                            }
                        }
                        Some(Err(e)) => {
                            close_status = "Error".to_string();
                            close_error = Some(e.to_string());
                            break;
                        }
                        None => {
                            // Connection ended cleanly by remote
                            close_status = "Closed".to_string();
                            break;
                        }
                    }
                }
            }
        }

        let _ = update_replayer_history_status(
            &pool_clone,
            &history_id_clone,
            &close_status,
            close_error.as_deref(),
        )
        .await;

        let _ = app_clone.emit(
            "replayer_ws_closed",
            ReplayerWsClosedPayload {
                session_id: session_id_clone.clone(),
                history_id: history_id_clone.clone(),
                status: close_status,
                error_message: close_error,
            },
        );

        // Remove from session map
        let mut map = WS_REPLAYER_SESSIONS.lock().await;
        if let Some(h) = map.get(&session_id_clone) {
            if h.history_id == history_id_clone {
                map.remove(&session_id_clone);
            }
        }
    });

    let abort_handle = join_handle.abort_handle();

    {
        let mut map = WS_REPLAYER_SESSIONS.lock().await;
        map.insert(
            session_id.clone(),
            WsSessionHandle {
                history_id: history_id.clone(),
                tx,
                abort_handle,
            },
        );
    }

    let payload = ReplayerWsConnectedPayload {
        session_id,
        history_id,
        base_url: normalized_url,
        request_raw: generated_req_raw,
        response_raw,
        status: "101 Switching Protocols".to_string(),
        created_at,
    };

    let _ = app.emit("replayer_ws_connected", &payload);

    Ok(payload)
}

#[tauri::command]
pub async fn send_replayer_ws_message(
    app: AppHandle,
    db: State<'_, DbState>,
    session_id: String,
    payload: String,
    message_type: Option<String>,
) -> Result<(), String> {
    let (history_id, tx) = {
        let map = WS_REPLAYER_SESSIONS.lock().await;
        let handle = map
            .get(&session_id)
            .ok_or_else(|| "No active WebSocket connection for this session".to_string())?;
        (handle.history_id.clone(), handle.tx.clone())
    };

    let m_type = message_type.unwrap_or_else(|| "Text".to_string());
    let now = current_time_ms();
    let pool = db.pool().await.map_err(|e| e.to_string())?;

    let (ws_msg, payload_len) = if m_type == "Binary" {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&payload)
            .map_err(|e| format!("Failed to decode base64 binary payload: {e}"))?;
        let len = bytes.len() as i64;
        (Message::Binary(bytes.into()), len)
    } else {
        let len = payload.len() as i64;
        (Message::Text(payload.clone().into()), len)
    };

    // 1. Send to server
    tx.send(ws_msg)
        .map_err(|e| format!("Failed to send frame to WebSocket stream: {e}"))?;

    // 2. Record to DB
    let msg_id = save_replayer_ws_message_record(
        &pool,
        &history_id,
        "ClientToServer",
        &m_type,
        &payload,
        payload_len,
        now,
    )
    .await
    .unwrap_or(0);

    // 3. Emit event to frontend
    let _ = app.emit(
        "replayer_ws_message",
        ReplayerWsMessagePayload {
            session_id,
            history_id,
            id: msg_id,
            direction: "ClientToServer".to_string(),
            message_type: m_type,
            payload,
            payload_length: payload_len,
            sent_at: now,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn disconnect_replayer_ws(
    app: AppHandle,
    db: State<'_, DbState>,
    session_id: String,
) -> Result<(), String> {
    let handle = {
        let mut map = WS_REPLAYER_SESSIONS.lock().await;
        map.remove(&session_id)
    };

    if let Some(h) = handle {
        let _ = h.tx.send(Message::Close(None));

        // RFC 6455 close timeout: allow up to 800ms for graceful frame transmission before aborting
        let abort_handle = h.abort_handle.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
            abort_handle.abort();
        });

        if let Ok(pool) = db.pool().await {
            let _ = update_replayer_history_status(
                &pool,
                &h.history_id,
                "Closed",
                None,
            )
            .await;
        }

        let _ = app.emit(
            "replayer_ws_closed",
            ReplayerWsClosedPayload {
                session_id: session_id.clone(),
                history_id: h.history_id,
                status: "Closed".to_string(),
                error_message: None,
            },
        );
    } else {
        let _ = app.emit(
            "replayer_ws_closed",
            ReplayerWsClosedPayload {
                session_id: session_id.clone(),
                history_id: String::new(),
                status: "Closed".to_string(),
                error_message: None,
            },
        );
    }

    Ok(())
}
