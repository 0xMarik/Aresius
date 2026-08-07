use crate::ares_utils::body_decoder;
use crate::ares_utils::certs::*;
use crate::ares_utils::http_connection::read_request_message;
use crate::ares_utils::http_connection::ConnectionOptions;
use crate::ares_utils::http_connection::HttpConnection;
use crate::ares_utils::parse::parse_request_line;
use crate::ares_utils::parse::parse_status_code;
use crate::ares_utils::parse::split_message;
use crate::proxy::utils::build_error_response;
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
pub mod utils;

pub use interceptor::*;

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
    host: String,
    method: String,
    path: String,
    query: Option<String>,
    extension: Option<String>,
    status_code: u16,
    response_length: usize,
    response_time_ms: u64,
    sent_at_ts_ms: u128,
}

pub struct CertCache {
    pub certs: Mutex<HashMap<String, (Vec<u8>, Vec<u8>)>>, // domain -> (cert_pem, key_pem)
}

impl CertCache {
    pub fn new() -> Self {
        Self {
            certs: Mutex::new(HashMap::new()),
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
    let mut buffer = [0u8; 8192];
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

    let (cert_pem, key_pem) =
        get_or_generate_server_cert(&app_handle, &domain, &ca_cert_pem, &ca_key_pair).await?;

    let acceptor = create_tls_acceptor(&cert_pem, &key_pem)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

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
        let sent_at_ts_ms = now_ms();
        let request_id = Uuid::new_v4().to_string();

        // Byte-exact source of truth for what actually gets forwarded
        // upstream. Stays untouched unless the user edits the request in
        // the intercept UI, mirroring how `outgoing_response_bytes` is
        // handled below for responses.
        let mut outgoing_request_bytes = raw_request.clone();
        if intercept_state
            .should_intercept(InterceptItemType::Request)
            .await
        {
            let item = InterceptItem {
                id: request_id.clone(),
                item_type: InterceptItemType::Request,
                host: target.clone(),
                method_or_status: extract_method_or_status(&decrypted_request, true),
                raw_message: decrypted_request.clone(),
                timestamp: sent_at_ts_ms,
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
                        // request on this same keep-alive connection.
                        outgoing_request_bytes = resync_edited_message(&mod_msg);
                    }
                    // else: untouched by the user -- forward the original
                    // bytes unchanged.
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!(
                        "Request dropped by user or state shutdown for {}",
                        request_id
                    );
                    continue;
                }
            }
        }

        let conn = match upstream.as_mut() {
            Some(c) => c,
            None => match HttpConnection::with_options(&upstream_url, connection_options.clone())
                .await
            {
                Ok(c) => {
                    upstream = Some(c);
                    upstream.as_mut().unwrap()
                }
                Err(e) => {
                    tracing::warn!("Failed to connect upstream {}: {}", target, e);
                    let error_response = build_error_response(&target, &e);
                    client_tls.write_all(&error_response).await.ok();
                    break;
                }
            },
        };

        let response = match conn.send_request(&outgoing_request_bytes).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Upstream request failed for {}: {}", target, e);
                // upstream = None;
                break;
            }
        };

        // Byte-exact reproduction of what the origin sent -- what actually
        // gets forwarded to the client.
        let mut outgoing_response_bytes = response.headers.clone().into_bytes();
        outgoing_response_bytes.extend_from_slice(&response.body);

        // Decoded copy, purely for the history/UI payload.
        let mut final_response_text =
            decode_for_display(&response.headers, &response.body, &connection_options);

        if intercept_state
            .should_intercept(InterceptItemType::Response)
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
                        // The displayed body was decoded for readability,
                        // so the original Content-Encoding/Content-Length
                        // no longer describe it once edited. Resync both
                        // the wire bytes and the history/UI copy so what
                        // the client receives and what gets logged agree.
                        outgoing_response_bytes = resync_edited_message(&mod_msg);
                        final_response_text =
                            String::from_utf8_lossy(&outgoing_response_bytes).to_string();
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Response dropped by user for {}", res_id);
                    continue;
                }
            }
        }

        let req_meta = parse_request_line(&outgoing_request_bytes);
        let (response_head, response_body) = split_message(&final_response_text);
        let status = parse_status_code(response_head);
        let response_length = response_body.as_bytes().len();

        let history_counter: tauri::State<HistoryIdCounter> = app_handle.state();
        app_handle
            .emit(
                "http_history",
                HttpHistoryPayload {
                    id: history_counter.next(),
                    raw_request: String::from_utf8_lossy(&outgoing_request_bytes).to_string(),
                    raw_response: final_response_text,
                    host: target.clone(),
                    method: req_meta.method,
                    path: req_meta.path,
                    query: req_meta.query,
                    extension: req_meta.extension,
                    status_code: status,
                    response_length,
                    response_time_ms: response.elapsed.as_millis() as u64,
                    sent_at_ts_ms: sent_at_ts_ms,
                },
            )
            .ok();

        if let Err(e) = client_tls.write_all(&outgoing_response_bytes).await {
            tracing::debug!("Client write failed for {}: {}", target, e);
            break;
        }
    }

    client_tls.shutdown().await.ok();
    Ok(())
}

/// Looks up a cached leaf cert for `domain`, or generates one. The
/// (CPU-bound, synchronous) signing work happens in spawn_blocking and
/// WITHOUT holding the cache lock, so one domain's first-visit cert
/// generation no longer stalls every other connection.
async fn get_or_generate_server_cert(
    app_handle: &AppHandle,
    domain: &str,
    ca_cert_pem: &str,
    ca_key_pair: &Arc<KeyPair>,
) -> std::io::Result<(Vec<u8>, Vec<u8>)> {
    let cert_cache: tauri::State<CertCache> = app_handle.state();

    let cached = {
        let cache = cert_cache.certs.lock().await;
        cache.get(domain).cloned()
    };
    if let Some(pair) = cached {
        return Ok(pair);
    }

    let ca_cert_pem = ca_cert_pem.to_string();
    let ca_key_pair = ca_key_pair.clone();
    let domain_owned = domain.to_string();

    let (cert, key) = tokio::task::spawn_blocking(move || {
        generate_server_cert(&ca_cert_pem, &ca_key_pair, &domain_owned)
    })
    .await
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    let mut cache = cert_cache.certs.lock().await;
    cache
        .entry(domain.to_string())
        .or_insert_with(|| (cert.clone(), key.clone()));

    Ok((cert, key))
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
        let sent_at_ts_ms = now_ms();
        let request_id = Uuid::new_v4().to_string();

        // Byte-exact source of truth for what actually gets forwarded
        // upstream -- see identical note in `handle_connect`.
        let mut outgoing_request_bytes = raw_request.clone();
        if intercept_state
            .should_intercept(InterceptItemType::Request)
            .await
        {
            let item = InterceptItem {
                id: request_id.clone(),
                item_type: InterceptItemType::Request,
                host: target.clone(),
                method_or_status: extract_method_or_status(&decrypted_request, true),
                raw_message: decrypted_request.clone(),
                timestamp: sent_at_ts_ms,
                is_https: false,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        // See identical note in `handle_connect` -- resync
                        // Content-Length to the edited body.
                        outgoing_request_bytes = resync_edited_message(&mod_msg);
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!(
                        "Request dropped by user or state shutdown for {}",
                        request_id
                    );
                    continue;
                }
            }
        }

        let conn = match upstream.as_mut() {
            Some(c) => c,
            None => match HttpConnection::with_options(&upstream_url, connection_options.clone())
                .await
            {
                Ok(c) => {
                    upstream = Some(c);
                    upstream.as_mut().unwrap()
                }
                Err(e) => {
                    tracing::warn!("Failed to connect upstream {}: {}", target, e);

                    break;
                }
            },
        };

        let response = match conn.send_request(&outgoing_request_bytes).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Upstream request failed for {}: {}", target, e);
                // upstream = None;
                break;
            }
        };

        let mut outgoing_response_bytes = response.headers.clone().into_bytes();
        outgoing_response_bytes.extend_from_slice(&response.body);

        let mut final_response_text =
            decode_for_display(&response.headers, &response.body, &connection_options);

        if intercept_state
            .should_intercept(InterceptItemType::Response)
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
                        // See identical note in `handle_connect` -- resync
                        // both the wire bytes and the history/UI copy.
                        outgoing_response_bytes = resync_edited_message(&mod_msg);
                        final_response_text =
                            String::from_utf8_lossy(&outgoing_response_bytes).to_string();
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Response dropped by user for {}", res_id);
                    continue;
                }
            }
        }

        let req_meta = parse_request_line(&outgoing_request_bytes);
        let (response_head, response_body) = split_message(&final_response_text);
        let status_code = parse_status_code(response_head);
        let response_length = response_body.as_bytes().len();

        let history_counter: tauri::State<HistoryIdCounter> = app_handle.state();
        app_handle
            .emit(
                "http_history",
                HttpHistoryPayload {
                    id: history_counter.next(),
                    raw_request: String::from_utf8_lossy(&outgoing_request_bytes).to_string(),
                    raw_response: final_response_text,
                    host: target.clone(),
                    method: req_meta.method,
                    path: req_meta.path,
                    query: req_meta.query,
                    extension: req_meta.extension,
                    status_code: status_code,
                    response_length,
                    response_time_ms: response.elapsed.as_millis() as u64,
                    sent_at_ts_ms: sent_at_ts_ms,
                },
            )
            .ok();

        if client_stream
            .write_all(&outgoing_response_bytes)
            .await
            .is_err()
        {
            break;
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
