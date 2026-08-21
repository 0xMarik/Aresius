use crate::ares_utils::body_decoder;
use crate::ares_utils::certs::*;
use crate::ares_utils::database::http_history::save_http_history;
use crate::ares_utils::database::DbState;
use crate::ares_utils::http_connection::read_request_message;
use crate::ares_utils::http_connection::ConnectionOptions;
use crate::ares_utils::http_connection::HttpConnection;
use crate::ares_utils::parse::parse_request_line;
use crate::ares_utils::parse::parse_status_code;
use crate::ares_utils::parse::split_message;
use crate::proxy::utils::{build_dropped_response, build_error_response};
use crate::proxy::utils::HistoryIdCounter;
use rcgen::KeyPair;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use uuid::Uuid;
pub mod interceptor;
pub mod match_replace;
pub mod utils;

pub use interceptor::*;
pub use match_replace::*;

/// Hard cap on a single request/response we'll buffer in memory.
/// Protects against unbounded growth on malformed or malicious framing.
const MAX_BODY_SIZE: usize = 25 * 1024 * 1024; // 25MB

/// How long to wait for the *next* request on a reused client connection
/// before giving up and letting the tunnel end. Deliberately generous and
/// separate from `ConnectionOptions::read_idle_timeout`, which only governs
/// stalls *mid*-request (slowloris protection) -- an idle keep-alive
/// connection between requests is normal, not an attack.
const KEEP_ALIVE_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HttpHistoryPayload {
    id: u32,
    raw_request: String,
    raw_response: String,
    request_auto_patch: Option<String>,
    request_manual_patch: Option<String>,
    response_auto_patch: Option<String>,
    response_manual_patch: Option<String>,
    request_edit_type: Option<String>,
    response_edit_type: Option<String>,
    host: String,
    method: String,
    path: String,
    query: Option<String>,
    extension: Option<String>,
    status_code: u16,
    response_length: usize,
    response_time_ms: u64,
    sent_at_ms: u128,
    is_https: bool,
} 

pub struct CertCache {
    pub acceptors: Mutex<HashMap<String, tokio_rustls::TlsAcceptor>>,
}

impl CertCache {
    pub fn new() -> Self {
        Self {
            acceptors: Mutex::new(HashMap::new()),
        }
    }
}

/// Options for the `HttpConnection`s used on both proxy legs (CONNECT
/// tunnels and plain HTTP). `auto_decode` is deliberately `false`: the
/// proxy must forward byte-exact responses to the client, so decoding (for
/// the history/UI payload only) is done separately via `body_decoder`
/// after the raw response is already in hand -- see `decode_for_display`.
fn proxy_connection_options() -> ConnectionOptions {
    ConnectionOptions {
        max_response_size: MAX_BODY_SIZE,
        auto_decode: false,
        ..ConnectionOptions::default()
    }
}

pub async fn start_http_proxy(app_handle: AppHandle, bind_addr: &str) -> std::io::Result<()> {
    // Generate CA certificate once at startup
    let (ca_cert_pem, key_pair) = generate_ca_cert(&app_handle)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let key_pair = Arc::new(key_pair);
    let connection_options = proxy_connection_options();

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!("MITM Proxy listening on {}", bind_addr);

    let app = app_handle.clone();
    loop {
        match listener.accept().await {
            Ok((client_stream, addr)) => {
                tracing::info!("New connection from: {}", addr);
                let ca_cert_pem = ca_cert_pem.clone();
                let key_pair = key_pair.clone();
                let app = app.clone();
                let connection_options = connection_options.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(
                        app,
                        client_stream,
                        ca_cert_pem,
                        key_pair,
                        connection_options,
                    )
                    .await
                    {
                        tracing::error!("Error handling client {}: {}", addr, e);
                    }
                });
            }
            Err(e) => tracing::error!("Connection failed: {}", e),
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

/// Decodes a raw `HttpConnection` response purely for the history/UI
/// payload. The bytes actually written back to the client always stay the
/// untouched originals (see call sites) -- decoding here must never affect
/// what's forwarded, or a client expecting `Content-Encoding: gzip` would
/// receive plaintext under headers that still claim otherwise.
fn decode_for_display(headers: &str, body: &[u8], options: &ConnectionOptions) -> String {
    let decoded = body_decoder::decode_response(headers, body.to_vec(), &options.decode_limits);
    format!(
        "{}{}",
        decoded.headers,
        String::from_utf8_lossy(&decoded.body)
    )
}

/// Rewrites a user-edited HTTP message (request or response) so its framing
/// headers match the body that's actually about to go on the wire.
///
/// The intercept UI shows a *decoded* body (see `decode_for_display`), so
/// once the user edits that text, whatever `Content-Encoding`,
/// `Transfer-Encoding`, or `Content-Length` the *original* message declared
/// no longer describes it. Forwarding those stale headers verbatim either
/// desyncs the peer's decompressor (wrong Content-Encoding) or its framing
/// (wrong Content-Length/Transfer-Encoding) -- the latter is especially bad
/// on a keep-alive connection, where it corrupts the read of whatever comes
/// next. We drop all three and recompute Content-Length from the edited
/// body, which is always truthful for a message we're about to send as one
/// unencoded, unchunked blob.
fn resync_edited_message(modified_message: &str) -> Vec<u8> {
    let (head, body) = modified_message
        .split_once("\r\n\r\n")
        .or_else(|| modified_message.split_once("\n\n"))
        .unwrap_or((modified_message, ""));

    let mut lines = head.lines();
    let start_line = lines.next().unwrap_or("").to_string();

    let mut out_headers: Vec<String> = lines
        .filter(|l| {
            let lower = l.to_ascii_lowercase();
            !(lower.starts_with("content-encoding:")
                || lower.starts_with("transfer-encoding:")
                || lower.starts_with("content-length:"))
        })
        .map(|l| l.to_string())
        .collect();
    out_headers.push(format!("Content-Length: {}", body.as_bytes().len()));

    let mut bytes = start_line.into_bytes();
    bytes.extend_from_slice(b"\r\n");
    for h in &out_headers {
        bytes.extend_from_slice(h.as_bytes());
        bytes.extend_from_slice(b"\r\n");
    }
    bytes.extend_from_slice(b"\r\n");
    bytes.extend_from_slice(body.as_bytes());
    bytes
}

// Main client handler
async fn handle_client(
    app_handle: AppHandle,
    mut client_stream: TcpStream,
    ca_cert_pem: String,
    ca_key_pair: Arc<KeyPair>,
    connection_options: ConnectionOptions,
) -> std::io::Result<()> {
    let mut buffer = [0u8; 65536];
    let bytes_read = client_stream.read(&mut buffer).await?;

    if bytes_read == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();

    if request.starts_with("CONNECT ") {
        handle_connect(
            app_handle,
            client_stream,
            &request,
            ca_cert_pem,
            ca_key_pair,
            connection_options,
        )
        .await
    } else {
        handle_http_request(
            app_handle,
            client_stream,
            buffer[..bytes_read].to_vec(),
            connection_options,
        )
        .await
    }
}

async fn handle_connect(
    app_handle: AppHandle,
    mut client_stream: TcpStream,
    request: &str,
    ca_cert_pem: String,
    ca_key_pair: Arc<KeyPair>,
    connection_options: ConnectionOptions,
) -> std::io::Result<()> {
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid CONNECT"))?
        .to_string();

    let domain = target.split(':').next().unwrap_or(&target).to_string();
    println!("MITM CONNECT to: {}", target);

    // Send 200 OK to client
    client_stream
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await?;

    let acceptor =
        get_or_create_tls_acceptor(&app_handle, &domain, &ca_cert_pem, &ca_key_pair).await?;

    // Perform TLS handshake with client
    let mut client_tls = acceptor.accept(client_stream).await?;

    // A single upstream HttpConnection is reused across every request on
    // this tunnel (keep-alive) and lazily (re)dialed on demand -- both on
    // first use and after any failed request, since HttpConnection only
    // self-marks as disconnected on a clean close / `Connection: close`,
    // not on a hard IO error.
    let upstream_url = format!("https://{}", target);
    let mut upstream: Option<HttpConnection> = None;
    let intercept_state: tauri::State<InterceptState> = app_handle.state();

    loop {
        let raw_request = match read_request_message(
            &mut client_tls,
            &connection_options,
            KEEP_ALIVE_IDLE_TIMEOUT,
        )
        .await
        {
            Ok(data) if data.is_empty() => break, // client closed the connection cleanly
            Ok(data) => data,
            Err(e) => {
                tracing::debug!("Client read ended for {}: {}", target, e);
                break;
            }
        };

        // Display/UI copy ONLY. This is a lossy conversion (any byte
        // sequence in the body that isn't valid UTF-8 -- e.g. HPKE
        // ciphertext, protobuf, msgpack -- gets replaced with U+FFFD) and
        // must never be what's actually put on the wire. See
        // `outgoing_request_bytes` below for the byte-exact copy that is.
        let decrypted_request = String::from_utf8_lossy(&raw_request).to_string();
        let original_raw_request_str = decrypted_request.clone();
        let mut req_automated = false;
        let mut req_manual = false;
        let sent_at_ms = now_ms();
        let request_id = Uuid::new_v4().to_string();

        // Byte-exact source of truth for what actually gets forwarded
        // upstream. Stays untouched unless the user edits the request in
        // the intercept UI, mirroring how `outgoing_response_bytes` is
        // handled below for responses.
        let mut outgoing_request_bytes = raw_request.clone();
        let req_meta_init = parse_request_line(&raw_request);
        let is_req_in_scope = intercept_state.is_url_in_scope(&target, &req_meta_init.path).await;
        let mut automated_raw_request_str: Option<String> = None;

        let match_replace_engine: tauri::State<MatchReplaceEngine> = app_handle.state();
        if match_replace_engine.has_request_rules(is_req_in_scope).await {
            let (mr_bytes, did_modify) = match_replace_engine
                .apply_request_transformations(&outgoing_request_bytes, is_req_in_scope)
                .await;
            if did_modify {
                outgoing_request_bytes = mr_bytes;
                req_automated = true;
                automated_raw_request_str = Some(String::from_utf8_lossy(&outgoing_request_bytes).to_string());
            }
        }

        let current_req_str = String::from_utf8_lossy(&outgoing_request_bytes).to_string();
        let req_eval_ctx = InterceptEvalContext {
            method: &req_meta_init.method,
            host: &target,
            path: &req_meta_init.path,
            query: req_meta_init.query.as_deref(),
            extension: req_meta_init.extension.as_deref(),
            status_code: 0,
            response_length: 0,
            response_time_ms: 0,
            sent_at_ms: sent_at_ms as i64,
            state: "",
            is_https: true,
            raw_request: Some(&current_req_str),
            raw_response: None,
        };

        if intercept_state
            .should_intercept(InterceptItemType::Request, &target, &req_meta_init.path, &req_eval_ctx)
            .await
        {
            let item = InterceptItem {
                id: request_id.clone(),
                item_type: InterceptItemType::Request,
                host: target.clone(),
                method_or_status: extract_method_or_status(&current_req_str, true),
                raw_message: current_req_str,
                timestamp: sent_at_ms,
                is_https: true,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        // User actually edited it in the UI -- resync the
                        // framing headers (Content-Length in particular)
                        // to the edited body before it goes on the wire.
                        // A fuzzing edit that changes body length but
                        // leaves a stale Content-Length would otherwise
                        // truncate/hang the request or desync the next
                        // pipelined request on this connection.
                        outgoing_request_bytes = resync_edited_message(&mod_msg);
                        req_manual = true;
                    }
                    // else: untouched by the user -- forward the original
                    // bytes unchanged.
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!(
                        "Request dropped by user or state shutdown for {}",
                        request_id
                    );
                    let drop_response = build_dropped_response(&target, true);
                    client_tls.write_all(&drop_response).await.ok();
                    break;
                }
            }
        }

        let request_edit_type = match (req_automated, req_manual) {
            (true, true) => Some("both".to_string()),
            (true, false) => Some("automated".to_string()),
            (false, true) => Some("manual".to_string()),
            (false, false) => None,
        };

        let mut request_auto_patch: Option<String> = None;
        let mut request_manual_patch: Option<String> = None;

        if req_automated {
            if let Some(ref auto_str) = automated_raw_request_str {
                request_auto_patch = Some(diffy::create_patch(&original_raw_request_str, auto_str).to_string());
            }
        }

        if req_manual {
            let manual_req_str = String::from_utf8_lossy(&outgoing_request_bytes).to_string();
            let base_for_manual = if req_automated {
                automated_raw_request_str.as_ref().unwrap_or(&original_raw_request_str)
            } else {
                &original_raw_request_str
            };
            request_manual_patch = Some(diffy::create_patch(base_for_manual, &manual_req_str).to_string());
        }

        let response = match upstream.as_mut() {
            Some(conn) => {
                match conn.send_request(&outgoing_request_bytes).await {
                    Ok(r) => Ok(r),
                    Err(e) => {
                        tracing::debug!(
                            "Reused upstream connection failed for {}: {}, reconnecting...",
                            target,
                            e
                        );
                        // Upstream server closed the idle keep-alive socket. Reconnect and retry once.
                        match HttpConnection::with_options(&upstream_url, connection_options.clone()).await {
                            Ok(mut fresh_conn) => {
                                let res = fresh_conn.send_request(&outgoing_request_bytes).await;
                                *conn = fresh_conn;
                                res
                            }
                            Err(reconnect_err) => Err(reconnect_err),
                        }
                    }
                }
            }
            None => {
                match HttpConnection::with_options(&upstream_url, connection_options.clone()).await {
                    Ok(mut new_conn) => {
                        let res = new_conn.send_request(&outgoing_request_bytes).await;
                        upstream = Some(new_conn);
                        res
                    }
                    Err(e) => {
                        tracing::warn!("Failed to connect upstream {}: {}", target, e);
                        let error_response = build_error_response(&target, &e);
                        client_tls.write_all(&error_response).await.ok();
                        break;
                    }
                }
            }
        };

        let response = match response {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Upstream request failed for {}: {}", target, e);
                break;
            }
        };

        // Byte-exact reproduction of what the origin sent -- what actually
        // gets forwarded to the client.
        let mut outgoing_response_bytes = response.headers.clone().into_bytes();
        outgoing_response_bytes.extend_from_slice(&response.body);

        let req_meta = parse_request_line(&outgoing_request_bytes);
        let is_res_in_scope = intercept_state.is_url_in_scope(&target, &req_meta.path).await;

        let has_body_mr = match_replace_engine.has_response_body_rules(is_res_in_scope).await;
        let has_header_mr = match_replace_engine.has_response_header_rules(is_res_in_scope).await;
        let mut pre_decoded_response_text: Option<String> = None;
        let mut res_automated = false;
        let mut res_manual = false;
        let mut original_raw_response_str: Option<String> = None;
        let mut automated_raw_response_str: Option<String> = None;

        if has_body_mr {
            // Decode body, apply replacements, and forward uncompressed to browser
            let limits = crate::ares_utils::body_decoder::DecodeLimits::default();
            let decoded = crate::ares_utils::body_decoder::decode_response(
                &response.headers,
                response.body.clone(),
                &limits,
            );
            original_raw_response_str = Some(format!("{}{}", decoded.headers, String::from_utf8_lossy(&decoded.body)));
            res_automated = true;

            let body_str = String::from_utf8_lossy(&decoded.body);
            let (mod_body_str, _) = match_replace_engine
                .apply_response_body_transformations(&body_str, is_res_in_scope)
                .await;

            let mut header_str = decoded.headers;
            if has_header_mr {
                let (mod_headers, _) = match_replace_engine
                    .apply_response_header_transformations(&header_str, is_res_in_scope)
                    .await;
                header_str = mod_headers;
            }

            let final_headers = crate::ares_utils::body_decoder::rewrite_headers(
                &header_str,
                mod_body_str.as_bytes().len(),
                true,
            );

            let mut final_wire_bytes = final_headers.as_bytes().to_vec();
            final_wire_bytes.extend_from_slice(mod_body_str.as_bytes());
            outgoing_response_bytes = final_wire_bytes;
            let auto_text = format!("{}{}", final_headers, mod_body_str);
            automated_raw_response_str = Some(auto_text.clone());
            pre_decoded_response_text = Some(auto_text);
        } else if has_header_mr {
            // Keep body compressed, modify only header block
            let (mod_headers, did_mod) = match_replace_engine
                .apply_response_header_transformations(&response.headers, is_res_in_scope)
                .await;
            if did_mod {
                let mut final_wire_bytes = mod_headers.as_bytes().to_vec();
                final_wire_bytes.extend_from_slice(&response.body);
                outgoing_response_bytes = final_wire_bytes;
                original_raw_response_str = Some(decode_for_display(&response.headers, &response.body, &connection_options));
                let auto_text = decode_for_display(&mod_headers, &response.body, &connection_options);
                automated_raw_response_str = Some(auto_text.clone());
                pre_decoded_response_text = Some(auto_text);
                res_automated = true;
            }
        }

        let mut final_response_text = if let Some(ref pre) = pre_decoded_response_text {
            pre.clone()
        } else {
            decode_for_display(&response.headers, &response.body, &connection_options)
        };
        let current_req_str_for_resp = String::from_utf8_lossy(&outgoing_request_bytes).to_string();
        let resp_eval_ctx = InterceptEvalContext {
            method: &req_meta.method,
            host: &target,
            path: &req_meta.path,
            query: req_meta.query.as_deref(),
            extension: req_meta.extension.as_deref(),
            status_code: parse_status_code(&response.headers) as i64,
            response_length: response.body.len() as i64,
            response_time_ms: response.elapsed.as_millis() as i64,
            sent_at_ms: sent_at_ms as i64,
            state: "",
            is_https: true,
            raw_request: Some(&current_req_str_for_resp),
            raw_response: Some(&final_response_text),
        };

        if intercept_state
            .should_intercept(InterceptItemType::Response, &target, &req_meta.path, &resp_eval_ctx)
            .await
        {
            let res_id = Uuid::new_v4().to_string();
            let item = InterceptItem {
                id: res_id.clone(),
                item_type: InterceptItemType::Response,
                host: target.clone(),
                method_or_status: extract_method_or_status(&final_response_text, false),
                raw_message: final_response_text.clone(),
                timestamp: now_ms(),
                is_https: true,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        if original_raw_response_str.is_none() {
                            original_raw_response_str = Some(final_response_text.clone());
                        }
                        // The displayed body was decoded for readability,
                        // so the original Content-Encoding/Content-Length
                        // no longer describe it once edited. Resync both
                        // the wire bytes and the history/UI copy so what
                        // the client receives and what gets logged agree.
                        outgoing_response_bytes = resync_edited_message(&mod_msg);
                        final_response_text =
                            String::from_utf8_lossy(&outgoing_response_bytes).to_string();
                        res_manual = true;
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Response dropped by user for {}", res_id);
                    let drop_response = build_dropped_response(&target, false);
                    client_tls.write_all(&drop_response).await.ok();
                    break;
                }
            }

            if let Err(e) = client_tls.write_all(&outgoing_response_bytes).await {
                tracing::debug!("Client write failed for {}: {}", target, e);
                break;
            }

            let res_was_modified = res_automated || res_manual;
            let response_edit_type = match (res_automated, res_manual) {
                (true, true) => Some("both".to_string()),
                (true, false) => Some("automated".to_string()),
                (false, true) => Some("manual".to_string()),
                (false, false) => None,
            };

            let mut response_auto_patch: Option<String> = None;
            let mut response_manual_patch: Option<String> = None;

            if res_automated {
                if let (Some(ref orig_res), Some(ref auto_res)) = (&original_raw_response_str, &automated_raw_response_str) {
                    response_auto_patch = Some(diffy::create_patch(orig_res, auto_res).to_string());
                }
            }

            if res_manual {
                let base_for_manual = if res_automated {
                    automated_raw_response_str.as_ref().or(original_raw_response_str.as_ref())
                } else {
                    original_raw_response_str.as_ref()
                };
                if let Some(base) = base_for_manual {
                    response_manual_patch = Some(diffy::create_patch(base, &final_response_text).to_string());
                }
            }

            let raw_response_to_store = if res_was_modified {
                original_raw_response_str.unwrap_or(final_response_text.clone())
            } else {
                final_response_text.clone()
            };

            let (response_head, response_body) = split_message(&final_response_text);
            let status = parse_status_code(response_head);
            let response_length = response_body.as_bytes().len();

            let history_counter: tauri::State<HistoryIdCounter> = app_handle.state();
            let payload = HttpHistoryPayload {
                id: history_counter.next(),
                raw_request: original_raw_request_str.clone(),
                raw_response: raw_response_to_store,
                request_auto_patch: request_auto_patch.clone(),
                request_manual_patch: request_manual_patch.clone(),
                response_auto_patch: response_auto_patch.clone(),
                response_manual_patch: response_manual_patch.clone(),
                request_edit_type: request_edit_type.clone(),
                response_edit_type: response_edit_type.clone(),
                host: target.clone(),
                method: req_meta.method,
                path: req_meta.path,
                query: req_meta.query,
                extension: req_meta.extension,
                status_code: status,
                response_length,
                response_time_ms: response.elapsed.as_millis() as u64,
                sent_at_ms: sent_at_ms,
                is_https: true,
            };
            app_handle.emit("http_history", payload.clone()).ok();

            let db_state: tauri::State<DbState> = app_handle.state();
            if let Ok(pool) = db_state.pool().await {
                if let Some(project_id) = db_state.get_active_id().await {
                    tokio::spawn(save_http_history(
                        pool,
                        project_id,
                        payload.host,
                        payload.method,
                        payload.path,
                        payload.query,
                        payload.extension,
                        payload.status_code,
                        payload.response_length,
                        payload.response_time_ms,
                        payload.sent_at_ms,
                        payload.is_https,
                        payload.raw_request,
                        payload.raw_response,
                        payload.request_auto_patch,
                        payload.request_manual_patch,
                        payload.response_auto_patch,
                        payload.response_manual_patch,
                        payload.request_edit_type,
                        payload.response_edit_type,
                    ));
                }
            }
        } else {
            // Write immediately to the client socket (zero TTFB delay for the browser)
            if let Err(e) = client_tls.write_all(&outgoing_response_bytes).await {
                tracing::debug!("Client write failed for {}: {}", target, e);
                break;
            }

            let res_was_modified = res_automated || res_manual;
            let response_edit_type = match (res_automated, res_manual) {
                (true, true) => Some("both".to_string()),
                (true, false) => Some("automated".to_string()),
                (false, true) => Some("manual".to_string()),
                (false, false) => None,
            };

            // Decompress, emit history, and save to DB in background
            let app_handle_bg = app_handle.clone();
            let target_bg = target.clone();
            let connection_options_bg = connection_options.clone();
            let req_meta_bg = req_meta;
            let response_elapsed = response.elapsed;
            let response_headers_bg = response.headers;
            let response_body_bg = response.body;
            let original_raw_request_str_bg = original_raw_request_str;
            let original_raw_response_str_bg = original_raw_response_str;
            let automated_raw_response_str_bg = automated_raw_response_str;
            let res_was_modified_bg = res_was_modified;
            let request_auto_patch_bg = request_auto_patch;
            let request_manual_patch_bg = request_manual_patch;
            let request_edit_type_bg = request_edit_type;
            let response_edit_type_bg = response_edit_type;
            let res_automated_bg = res_automated;

            tokio::spawn(async move {
                let final_response_text = if let Some(pre) = pre_decoded_response_text {
                    pre
                } else {
                    tokio::task::spawn_blocking(move || {
                        decode_for_display(&response_headers_bg, &response_body_bg, &connection_options_bg)
                    })
                    .await
                    .unwrap_or_default()
                };

                let mut response_auto_patch: Option<String> = None;
                if res_automated_bg {
                    if let (Some(ref orig_res), Some(ref auto_res)) = (&original_raw_response_str_bg, &automated_raw_response_str_bg) {
                        response_auto_patch = Some(diffy::create_patch(orig_res, auto_res).to_string());
                    }
                }

                let raw_response_to_store = if res_was_modified_bg {
                    original_raw_response_str_bg.unwrap_or(final_response_text.clone())
                } else {
                    final_response_text.clone()
                };

                let (response_head, response_body) = split_message(&final_response_text);
                let status = parse_status_code(response_head);
                let response_length = response_body.as_bytes().len();

                let history_counter: tauri::State<HistoryIdCounter> = app_handle_bg.state();
                let payload = HttpHistoryPayload {
                    id: history_counter.next(),
                    raw_request: original_raw_request_str_bg,
                    raw_response: raw_response_to_store,
                    request_auto_patch: request_auto_patch_bg,
                    request_manual_patch: request_manual_patch_bg,
                    response_auto_patch,
                    response_manual_patch: None,
                    request_edit_type: request_edit_type_bg,
                    response_edit_type: response_edit_type_bg,
                    host: target_bg,
                    method: req_meta_bg.method,
                    path: req_meta_bg.path,
                    query: req_meta_bg.query,
                    extension: req_meta_bg.extension,
                    status_code: status,
                    response_length,
                    response_time_ms: response_elapsed.as_millis() as u64,
                    sent_at_ms: sent_at_ms,
                    is_https: true,
                };
                app_handle_bg.emit("http_history", payload.clone()).ok();

                let db_state: tauri::State<DbState> = app_handle_bg.state();
                if let Ok(pool) = db_state.pool().await {
                    if let Some(project_id) = db_state.get_active_id().await {
                        save_http_history(
                            pool,
                            project_id,
                            payload.host,
                            payload.method,
                            payload.path,
                            payload.query,
                            payload.extension,
                            payload.status_code,
                            payload.response_length,
                            payload.response_time_ms,
                            payload.sent_at_ms,
                            payload.is_https,
                            payload.raw_request,
                            payload.raw_response,
                            payload.request_auto_patch,
                            payload.request_manual_patch,
                            payload.response_auto_patch,
                            payload.response_manual_patch,
                            payload.request_edit_type,
                            payload.response_edit_type,
                        )
                        .await
                        .ok();
                    }
                }
            });
        }
    }

    client_tls.shutdown().await.ok();
    Ok(())
}

/// Looks up a cached `TlsAcceptor` for `domain`, or generates the leaf cert and creates one.
/// The (CPU-bound, synchronous) signing and cert parsing happens in spawn_blocking
/// WITHOUT holding the cache lock, and the resulting `TlsAcceptor` is cached directly so
/// subsequent connections to the same domain avoid all PEM parsing and crypto setup.
async fn get_or_create_tls_acceptor(
    app_handle: &AppHandle,
    domain: &str,
    ca_cert_pem: &str,
    ca_key_pair: &Arc<KeyPair>,
) -> std::io::Result<tokio_rustls::TlsAcceptor> {
    let cert_cache: tauri::State<CertCache> = app_handle.state();

    let cached = {
        let cache = cert_cache.acceptors.lock().await;
        cache.get(domain).cloned()
    };
    if let Some(acceptor) = cached {
        return Ok(acceptor);
    }

    let ca_cert_pem = ca_cert_pem.to_string();
    let ca_key_pair = ca_key_pair.clone();
    let domain_owned = domain.to_string();

    let acceptor = tokio::task::spawn_blocking(move || -> std::io::Result<tokio_rustls::TlsAcceptor> {
        let (cert_pem, key_pem) = generate_server_cert(&ca_cert_pem, &ca_key_pair, &domain_owned)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        create_tls_acceptor(&cert_pem, &key_pem)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    })
    .await
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))??;

    let mut cache = cert_cache.acceptors.lock().await;
    cache.insert(domain.to_string(), acceptor.clone());

    Ok(acceptor)
}

/// Plain HTTP gets the same intercept/log/modify/decode treatment as HTTPS.
async fn handle_http_request(
    app_handle: AppHandle,
    mut client_stream: TcpStream,
    first_request_bytes: Vec<u8>,
    connection_options: ConnectionOptions,
) -> std::io::Result<()> {
    let target = parse_target(&String::from_utf8_lossy(&first_request_bytes))?;
    let upstream_url = format!("http://{}", target);
    let mut upstream: Option<HttpConnection> = None;
    // NOTE (pre-existing limitation, carried over unchanged): the very
    // first request is whatever `handle_client`'s initial 8KB read
    // captured, not re-framed through `read_request_message`. If that
    // first request's body is larger than one read or arrives split
    // across reads, it can be incomplete. Every subsequent request on
    // this connection is fully framed via `read_request_message` below.
    let mut pending_bytes = Some(first_request_bytes);
    let intercept_state: tauri::State<InterceptState> = app_handle.state();

    loop {
        let raw_request = match pending_bytes.take() {
            Some(b) => b,
            None => match read_request_message(
                &mut client_stream,
                &connection_options,
                KEEP_ALIVE_IDLE_TIMEOUT,
            )
            .await
            {
                Ok(data) if data.is_empty() => break,
                Ok(data) => data,
                Err(_) => break,
            },
        };

        // Display/UI copy ONLY -- see identical note in `handle_connect`.
        let decrypted_request = String::from_utf8_lossy(&raw_request).to_string();
        let original_raw_request_str = decrypted_request.clone();
        let mut req_automated = false;
        let mut req_manual = false;
        let sent_at_ms = now_ms();
        let request_id = Uuid::new_v4().to_string();

        // Byte-exact source of truth for what actually gets forwarded
        // upstream -- see identical note in `handle_connect`.
        let mut outgoing_request_bytes = raw_request.clone();
        let req_meta_init = parse_request_line(&raw_request);
        let is_req_in_scope = intercept_state.is_url_in_scope(&target, &req_meta_init.path).await;
        let mut automated_raw_request_str: Option<String> = None;

        let match_replace_engine: tauri::State<MatchReplaceEngine> = app_handle.state();
        if match_replace_engine.has_request_rules(is_req_in_scope).await {
            let (mr_bytes, did_modify) = match_replace_engine
                .apply_request_transformations(&outgoing_request_bytes, is_req_in_scope)
                .await;
            if did_modify {
                outgoing_request_bytes = mr_bytes;
                req_automated = true;
                automated_raw_request_str = Some(String::from_utf8_lossy(&outgoing_request_bytes).to_string());
            }
        }

        let current_req_str = String::from_utf8_lossy(&outgoing_request_bytes).to_string();
        let req_eval_ctx = InterceptEvalContext {
            method: &req_meta_init.method,
            host: &target,
            path: &req_meta_init.path,
            query: req_meta_init.query.as_deref(),
            extension: req_meta_init.extension.as_deref(),
            status_code: 0,
            response_length: 0,
            response_time_ms: 0,
            sent_at_ms: sent_at_ms as i64,
            state: "",
            is_https: false,
            raw_request: Some(&current_req_str),
            raw_response: None,
        };

        if intercept_state
            .should_intercept(InterceptItemType::Request, &target, &req_meta_init.path, &req_eval_ctx)
            .await
        {
            let item = InterceptItem {
                id: request_id.clone(),
                item_type: InterceptItemType::Request,
                host: target.clone(),
                method_or_status: extract_method_or_status(&current_req_str, true),
                raw_message: current_req_str,
                timestamp: sent_at_ms,
                is_https: false,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        // See identical note in `handle_connect` -- resync
                        // Content-Length to the edited body.
                        outgoing_request_bytes = resync_edited_message(&mod_msg);
                        req_manual = true;
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!(
                        "Request dropped by user or state shutdown for {}",
                        request_id
                    );
                    let drop_response = build_dropped_response(&target, true);
                    client_stream.write_all(&drop_response).await.ok();
                    break;
                }
            }
        }

        let request_edit_type = match (req_automated, req_manual) {
            (true, true) => Some("both".to_string()),
            (true, false) => Some("automated".to_string()),
            (false, true) => Some("manual".to_string()),
            (false, false) => None,
        };

        let mut request_auto_patch: Option<String> = None;
        let mut request_manual_patch: Option<String> = None;

        if req_automated {
            if let Some(ref auto_str) = automated_raw_request_str {
                request_auto_patch = Some(diffy::create_patch(&original_raw_request_str, auto_str).to_string());
            }
        }

        if req_manual {
            let manual_req_str = String::from_utf8_lossy(&outgoing_request_bytes).to_string();
            let base_for_manual = if req_automated {
                automated_raw_request_str.as_ref().unwrap_or(&original_raw_request_str)
            } else {
                &original_raw_request_str
            };
            request_manual_patch = Some(diffy::create_patch(base_for_manual, &manual_req_str).to_string());
        }

        let response = match upstream.as_mut() {
            Some(conn) => {
                match conn.send_request(&outgoing_request_bytes).await {
                    Ok(r) => Ok(r),
                    Err(e) => {
                        tracing::debug!(
                            "Reused plain HTTP connection failed for {}: {}, reconnecting...",
                            target,
                            e
                        );
                        match HttpConnection::with_options(&upstream_url, connection_options.clone()).await {
                            Ok(mut fresh_conn) => {
                                let res = fresh_conn.send_request(&outgoing_request_bytes).await;
                                *conn = fresh_conn;
                                res
                            }
                            Err(reconnect_err) => Err(reconnect_err),
                        }
                    }
                }
            }
            None => {
                match HttpConnection::with_options(&upstream_url, connection_options.clone()).await {
                    Ok(mut new_conn) => {
                        let res = new_conn.send_request(&outgoing_request_bytes).await;
                        upstream = Some(new_conn);
                        res
                    }
                    Err(e) => {
                        tracing::warn!("Failed to connect upstream {}: {}", target, e);
                        break;
                    }
                }
            }
        };

        let response = match response {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Upstream request failed for {}: {}", target, e);
                break;
            }
        };

        let mut outgoing_response_bytes = response.headers.clone().into_bytes();
        outgoing_response_bytes.extend_from_slice(&response.body);

        let req_meta = parse_request_line(&outgoing_request_bytes);
        let is_res_in_scope = intercept_state.is_url_in_scope(&target, &req_meta.path).await;

        let has_body_mr = match_replace_engine.has_response_body_rules(is_res_in_scope).await;
        let has_header_mr = match_replace_engine.has_response_header_rules(is_res_in_scope).await;
        let mut pre_decoded_response_text: Option<String> = None;
        let mut res_automated = false;
        let mut res_manual = false;
        let mut original_raw_response_str: Option<String> = None;
        let mut automated_raw_response_str: Option<String> = None;

        if has_body_mr {
            // Decode body, apply replacements, and forward uncompressed to browser
            let limits = crate::ares_utils::body_decoder::DecodeLimits::default();
            let decoded = crate::ares_utils::body_decoder::decode_response(
                &response.headers,
                response.body.clone(),
                &limits,
            );
            original_raw_response_str = Some(format!("{}{}", decoded.headers, String::from_utf8_lossy(&decoded.body)));
            res_automated = true;

            let body_str = String::from_utf8_lossy(&decoded.body);
            let (mod_body_str, _) = match_replace_engine
                .apply_response_body_transformations(&body_str, is_res_in_scope)
                .await;

            let mut header_str = decoded.headers;
            if has_header_mr {
                let (mod_headers, _) = match_replace_engine
                    .apply_response_header_transformations(&header_str, is_res_in_scope)
                    .await;
                header_str = mod_headers;
            }

            let final_headers = crate::ares_utils::body_decoder::rewrite_headers(
                &header_str,
                mod_body_str.as_bytes().len(),
                true,
            );

            let mut final_wire_bytes = final_headers.as_bytes().to_vec();
            final_wire_bytes.extend_from_slice(mod_body_str.as_bytes());
            outgoing_response_bytes = final_wire_bytes;
            let auto_text = format!("{}{}", final_headers, mod_body_str);
            automated_raw_response_str = Some(auto_text.clone());
            pre_decoded_response_text = Some(auto_text);
        } else if has_header_mr {
            // Keep body compressed, modify only header block
            let (mod_headers, did_mod) = match_replace_engine
                .apply_response_header_transformations(&response.headers, is_res_in_scope)
                .await;
            if did_mod {
                let mut final_wire_bytes = mod_headers.as_bytes().to_vec();
                final_wire_bytes.extend_from_slice(&response.body);
                outgoing_response_bytes = final_wire_bytes;
                original_raw_response_str = Some(decode_for_display(&response.headers, &response.body, &connection_options));
                let auto_text = decode_for_display(&mod_headers, &response.body, &connection_options);
                automated_raw_response_str = Some(auto_text.clone());
                pre_decoded_response_text = Some(auto_text);
                res_automated = true;
            }
        }

        let mut final_response_text = if let Some(ref pre) = pre_decoded_response_text {
            pre.clone()
        } else {
            decode_for_display(&response.headers, &response.body, &connection_options)
        };
        let current_req_str_for_resp = String::from_utf8_lossy(&outgoing_request_bytes).to_string();
        let resp_eval_ctx = InterceptEvalContext {
            method: &req_meta.method,
            host: &target,
            path: &req_meta.path,
            query: req_meta.query.as_deref(),
            extension: req_meta.extension.as_deref(),
            status_code: parse_status_code(&response.headers) as i64,
            response_length: response.body.len() as i64,
            response_time_ms: response.elapsed.as_millis() as i64,
            sent_at_ms: sent_at_ms as i64,
            state: "",
            is_https: false,
            raw_request: Some(&current_req_str_for_resp),
            raw_response: Some(&final_response_text),
        };

        if intercept_state
            .should_intercept(InterceptItemType::Response, &target, &req_meta.path, &resp_eval_ctx)
            .await
        {
            let res_id = Uuid::new_v4().to_string();
            let item = InterceptItem {
                id: res_id.clone(),
                item_type: InterceptItemType::Response,
                host: target.clone(),
                method_or_status: extract_method_or_status(&final_response_text, false),
                raw_message: final_response_text.clone(),
                timestamp: now_ms(),
                is_https: false,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        if original_raw_response_str.is_none() {
                            original_raw_response_str = Some(final_response_text.clone());
                        }
                        // See identical note in `handle_connect` -- resync
                        // both the wire bytes and the history/UI copy.
                        outgoing_response_bytes = resync_edited_message(&mod_msg);
                        final_response_text =
                            String::from_utf8_lossy(&outgoing_response_bytes).to_string();
                        res_manual = true;
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Response dropped by user for {}", res_id);
                    let drop_response = build_dropped_response(&target, false);
                    client_stream.write_all(&drop_response).await.ok();
                    break;
                }
            }

            if client_stream
                .write_all(&outgoing_response_bytes)
                .await
                .is_err()
            {
                break;
            }

            let res_was_modified = res_automated || res_manual;
            let response_edit_type = match (res_automated, res_manual) {
                (true, true) => Some("both".to_string()),
                (true, false) => Some("automated".to_string()),
                (false, true) => Some("manual".to_string()),
                (false, false) => None,
            };

            let mut response_auto_patch: Option<String> = None;
            let mut response_manual_patch: Option<String> = None;

            if res_automated {
                if let (Some(ref orig_res), Some(ref auto_res)) = (&original_raw_response_str, &automated_raw_response_str) {
                    response_auto_patch = Some(diffy::create_patch(orig_res, auto_res).to_string());
                }
            }

            if res_manual {
                let base_for_manual = if res_automated {
                    automated_raw_response_str.as_ref().or(original_raw_response_str.as_ref())
                } else {
                    original_raw_response_str.as_ref()
                };
                if let Some(base) = base_for_manual {
                    response_manual_patch = Some(diffy::create_patch(base, &final_response_text).to_string());
                }
            }

            let raw_response_to_store = if res_was_modified {
                original_raw_response_str.unwrap_or(final_response_text.clone())
            } else {
                final_response_text.clone()
            };

            let (response_head, response_body) = split_message(&final_response_text);
            let status_code = parse_status_code(response_head);
            let response_length = response_body.as_bytes().len();

            let history_counter: tauri::State<HistoryIdCounter> = app_handle.state();
            let payload = HttpHistoryPayload {
                id: history_counter.next(),
                raw_request: original_raw_request_str.clone(),
                raw_response: raw_response_to_store,
                request_auto_patch: request_auto_patch.clone(),
                request_manual_patch: request_manual_patch.clone(),
                response_auto_patch: response_auto_patch.clone(),
                response_manual_patch: response_manual_patch.clone(),
                request_edit_type: request_edit_type.clone(),
                response_edit_type: response_edit_type.clone(),
                host: target.clone(),
                method: req_meta.method,
                path: req_meta.path,
                query: req_meta.query,
                extension: req_meta.extension,
                status_code: status_code,
                response_length,
                response_time_ms: response.elapsed.as_millis() as u64,
                sent_at_ms: sent_at_ms,
                is_https: false,
            };
            app_handle.emit("http_history", payload.clone()).ok();

            let db_state: tauri::State<DbState> = app_handle.state();
            if let Ok(pool) = db_state.pool().await {
                if let Some(project_id) = db_state.get_active_id().await {
                    tokio::spawn(save_http_history(
                        pool,
                        project_id,
                        payload.host,
                        payload.method,
                        payload.path,
                        payload.query,
                        payload.extension,
                        payload.status_code,
                        payload.response_length,
                        payload.response_time_ms,
                        payload.sent_at_ms,
                        payload.is_https,
                        payload.raw_request,
                        payload.raw_response,
                        payload.request_auto_patch,
                        payload.request_manual_patch,
                        payload.response_auto_patch,
                        payload.response_manual_patch,
                        payload.request_edit_type,
                        payload.response_edit_type,
                    ));
                }
            }
        } else {
            // Write immediately to the client socket (zero TTFB delay for the browser)
            if client_stream
                .write_all(&outgoing_response_bytes)
                .await
                .is_err()
            {
                break;
            }

            let res_was_modified = res_automated || res_manual;
            let response_edit_type = match (res_automated, res_manual) {
                (true, true) => Some("both".to_string()),
                (true, false) => Some("automated".to_string()),
                (false, true) => Some("manual".to_string()),
                (false, false) => None,
            };

            // Decompress, emit history, and save to DB in background
            let app_handle_bg = app_handle.clone();
            let target_bg = target.clone();
            let connection_options_bg = connection_options.clone();
            let req_meta_bg = req_meta;
            let response_elapsed = response.elapsed;
            let response_headers_bg = response.headers;
            let response_body_bg = response.body;
            let original_raw_request_str_bg = original_raw_request_str;
            let original_raw_response_str_bg = original_raw_response_str;
            let automated_raw_response_str_bg = automated_raw_response_str;
            let res_was_modified_bg = res_was_modified;
            let request_auto_patch_bg = request_auto_patch;
            let request_manual_patch_bg = request_manual_patch;
            let request_edit_type_bg = request_edit_type;
            let response_edit_type_bg = response_edit_type;
            let res_automated_bg = res_automated;

            tokio::spawn(async move {
                let final_response_text = if let Some(pre) = pre_decoded_response_text {
                    pre
                } else {
                    tokio::task::spawn_blocking(move || {
                        decode_for_display(&response_headers_bg, &response_body_bg, &connection_options_bg)
                    })
                    .await
                    .unwrap_or_default()
                };

                let mut response_auto_patch: Option<String> = None;
                if res_automated_bg {
                    if let (Some(ref orig_res), Some(ref auto_res)) = (&original_raw_response_str_bg, &automated_raw_response_str_bg) {
                        response_auto_patch = Some(diffy::create_patch(orig_res, auto_res).to_string());
                    }
                }

                let raw_response_to_store = if res_was_modified_bg {
                    original_raw_response_str_bg.unwrap_or(final_response_text.clone())
                } else {
                    final_response_text.clone()
                };

                let (response_head, response_body) = split_message(&final_response_text);
                let status_code = parse_status_code(response_head);
                let response_length = response_body.as_bytes().len();

                let history_counter: tauri::State<HistoryIdCounter> = app_handle_bg.state();
                let payload = HttpHistoryPayload {
                    id: history_counter.next(),
                    raw_request: original_raw_request_str_bg,
                    raw_response: raw_response_to_store,
                    request_auto_patch: request_auto_patch_bg,
                    request_manual_patch: request_manual_patch_bg,
                    response_auto_patch,
                    response_manual_patch: None,
                    request_edit_type: request_edit_type_bg,
                    response_edit_type: response_edit_type_bg,
                    host: target_bg,
                    method: req_meta_bg.method,
                    path: req_meta_bg.path,
                    query: req_meta_bg.query,
                    extension: req_meta_bg.extension,
                    status_code: status_code,
                    response_length,
                    response_time_ms: response_elapsed.as_millis() as u64,
                    sent_at_ms: sent_at_ms,
                    is_https: false,
                };
                app_handle_bg.emit("http_history", payload.clone()).ok();

                let db_state: tauri::State<DbState> = app_handle_bg.state();
                if let Ok(pool) = db_state.pool().await {
                    if let Some(project_id) = db_state.get_active_id().await {
                        save_http_history(
                            pool,
                            project_id,
                            payload.host,
                            payload.method,
                            payload.path,
                            payload.query,
                            payload.extension,
                            payload.status_code,
                            payload.response_length,
                            payload.response_time_ms,
                            payload.sent_at_ms,
                            payload.is_https,
                            payload.raw_request,
                            payload.raw_response,
                            payload.request_auto_patch,
                            payload.request_manual_patch,
                            payload.response_auto_patch,
                            payload.response_manual_patch,
                            payload.request_edit_type,
                            payload.response_edit_type,
                        )
                        .await
                        .ok();
                    }
                }
            });
        }
    }
    Ok(())
}

fn parse_target(request: &str) -> std::io::Result<String> {
    for line in request.lines() {
        if line.to_lowercase().starts_with("host:") {
            let host = line[5..].trim();
            if host.contains(':') {
                return Ok(host.to_string());
            } else {
                return Ok(format!("{}:80", host));
            }
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "No Host header found",
    ))
}
