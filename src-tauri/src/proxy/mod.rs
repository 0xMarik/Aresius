use crate::ares_utils::certs::*;
use crate::proxy::utils::HistoryIdCounter;
use rcgen::KeyPair;
use rustls::{pki_types::ServerName, ClientConfig, RootCertStore};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::client::TlsStream as ClientTlsStream;
use tokio_rustls::TlsConnector;
use uuid::Uuid;
pub mod interceptor;
pub mod utils;

pub use interceptor::*;

/// Hard cap on a single request/response we'll buffer in memory.
/// Protects against unbounded growth on malformed or malicious framing.
const MAX_BODY_SIZE: usize = 25 * 1024 * 1024; // 25MB

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HttpHistoryPayload {
    id: u32,
    raw_request: String,
    raw_response: String,
    host: String,
    timestamp: u128,
    duration: Option<u64>,
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

pub async fn start_http_proxy(app_handle: AppHandle, bind_addr: &str) -> std::io::Result<()> {
    // Generate CA certificate once at startup
    let (ca_cert_pem, key_pair) = generate_ca_cert(&app_handle)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let key_pair = Arc::new(key_pair);

    // Build the upstream TLS client config ONCE. Previously this loaded
    // native root certs from disk on every intercepted request.
    let upstream_tls_config = Arc::new(build_upstream_tls_config()?);

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
                let upstream_tls_config = upstream_tls_config.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(
                        app,
                        client_stream,
                        ca_cert_pem,
                        key_pair,
                        upstream_tls_config,
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

fn build_upstream_tls_config() -> std::io::Result<ClientConfig> {
    let mut root_store = RootCertStore::empty();

    // load_native_certs() is infallible: it returns whatever certs it could
    // find plus a separate list of per-source errors, rather than an
    // all-or-nothing Result. Log the errors but keep going with whatever
    // succeeded — that mirrors what the crate itself recommends.
    let result = rustls_native_certs::load_native_certs();

    for err in &result.errors {
        tracing::warn!("Error loading a native cert source: {}", err);
    }

    for cert in result.certs {
        root_store.add(cert).ok();
    }

    if root_store.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "No native root certificates could be loaded",
        ));
    }

    Ok(ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth())
}

/// Waits for the frontend's decision on an intercepted request, with a
/// timeout. If the frontend never responds (closed UI, crash, etc.) we
/// clean up the pending entry ourselves instead of leaking it forever.
fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

// Main client handler
async fn handle_client(
    app_handle: AppHandle,
    mut client_stream: TcpStream,
    ca_cert_pem: String,
    ca_key_pair: Arc<KeyPair>,
    upstream_tls_config: Arc<ClientConfig>,
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
            upstream_tls_config,
        )
        .await
    } else {
        handle_http_request(app_handle, client_stream, buffer[..bytes_read].to_vec()).await
    }
}

async fn handle_connect(
    app_handle: AppHandle,
    mut client_stream: TcpStream,
    request: &str,
    ca_cert_pem: String,
    ca_key_pair: Arc<KeyPair>,
    upstream_tls_config: Arc<ClientConfig>,
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

    // A single upstream TLS connection is reused across every request on
    // this tunnel (keep-alive), and re-established on demand if it drops.
    let mut server_tls: Option<ClientTlsStream<TcpStream>> = None;
    let intercept_state: tauri::State<InterceptState> = app_handle.state();

    loop {
        let raw_request = match read_full_message(&mut client_tls, false).await {
            Ok(data) if data.is_empty() => break, // client closed the connection cleanly
            Ok(data) => data,
            Err(e) => {
                tracing::debug!("Client read ended for {}: {}", target, e);
                break;
            }
        };

        let decrypted_request = String::from_utf8_lossy(&raw_request).to_string();
        let ts_ms = now_ms();
        let request_id = Uuid::new_v4().to_string();

        let mut outgoing_request_text = decrypted_request.clone();
        if intercept_state.should_intercept(InterceptItemType::Request).await {
            let item = InterceptItem {
                id: request_id.clone(),
                item_type: InterceptItemType::Request,
                host: target.clone(),
                method_or_status: extract_method_or_status(&decrypted_request, true),
                raw_message: decrypted_request.clone(),
                timestamp: ts_ms,
                is_https: true,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        outgoing_request_text = mod_msg;
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Request dropped by user or state shutdown for {}", request_id);
                    continue;
                }
            }
        }

        if server_tls.is_none() {
            match connect_upstream_tls(&target, &domain, upstream_tls_config.clone()).await {
                Ok(s) => server_tls = Some(s),
                Err(e) => {
                    tracing::warn!("Failed to connect upstream {}: {}", target, e);
                    client_tls
                        .write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                        .await
                        .ok();
                    break;
                }
            }
        }

        let start = std::time::Instant::now();
        let conn = server_tls.as_mut().unwrap();

        if let Err(e) = conn.write_all(outgoing_request_text.as_bytes()).await {
            tracing::warn!("Upstream write failed for {}: {}", target, e);
            server_tls = None;
            break;
        }

        let response_bytes = match read_full_message(conn, true).await {
            Ok(data) => data,
            Err(e) => {
                tracing::warn!("Upstream read failed for {}: {}", target, e);
                server_tls = None;
                break;
            }
        };

        let duration = start.elapsed();
        let decrypted_response = String::from_utf8_lossy(&response_bytes).to_string();

        let mut outgoing_response_bytes = response_bytes;
        let mut final_response_text = decrypted_response.clone();

        if intercept_state.should_intercept(InterceptItemType::Response).await {
            let res_id = Uuid::new_v4().to_string();
            let item = InterceptItem {
                id: res_id.clone(),
                item_type: InterceptItemType::Response,
                host: target.clone(),
                method_or_status: extract_method_or_status(&decrypted_response, false),
                raw_message: decrypted_response.clone(),
                timestamp: now_ms(),
                is_https: true,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        final_response_text = mod_msg.clone();
                        outgoing_response_bytes = mod_msg.into_bytes();
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Response dropped by user for {}", res_id);
                    continue;
                }
            }
        }

        let history_counter: tauri::State<HistoryIdCounter> = app_handle.state();
        app_handle
            .emit(
                "http_history",
                HttpHistoryPayload {
                    id: history_counter.next(),
                    raw_request: outgoing_request_text,
                    raw_response: final_response_text,
                    host: target.clone(),
                    timestamp: ts_ms,
                    duration: Some(duration.as_millis() as u64),
                },
            )
            .ok();

        if let Err(e) = client_tls.write_all(&outgoing_response_bytes).await {
            tracing::debug!("Client write failed for {}: {}", target, e);
            break;
        }
    }

    if let Some(mut s) = server_tls {
        s.shutdown().await.ok();
    }
    client_tls.shutdown().await.ok();
    Ok(())
}

async fn connect_upstream_tls(
    target: &str,
    domain: &str,
    upstream_tls_config: Arc<ClientConfig>,
) -> std::io::Result<ClientTlsStream<TcpStream>> {
    let server_stream = TcpStream::connect(target).await?;
    let connector = TlsConnector::from(upstream_tls_config);
    let server_name = ServerName::try_from(domain.to_string())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    connector.connect(server_name, server_stream).await
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

/// Plain HTTP now gets the same intercept/log/modify treatment as HTTPS,
/// instead of being blind-tunneled with copy_bidirectional.
async fn handle_http_request(
    app_handle: AppHandle,
    mut client_stream: TcpStream,
    first_request_bytes: Vec<u8>,
) -> std::io::Result<()> {
    let target = parse_target(&String::from_utf8_lossy(&first_request_bytes))?;
    let mut server_stream: Option<TcpStream> = None;
    let mut pending_bytes = Some(first_request_bytes);
    let intercept_state: tauri::State<InterceptState> = app_handle.state();

    loop {
        let raw_request = match pending_bytes.take() {
            Some(b) => b,
            None => match read_full_message(&mut client_stream, false).await {
                Ok(data) if data.is_empty() => break,
                Ok(data) => data,
                Err(_) => break,
            },
        };

        let decrypted_request = String::from_utf8_lossy(&raw_request).to_string();
        let ts_ms = now_ms();
        let request_id = Uuid::new_v4().to_string();

        let mut outgoing_request_text = decrypted_request.clone();
        if intercept_state.should_intercept(InterceptItemType::Request).await {
            let item = InterceptItem {
                id: request_id.clone(),
                item_type: InterceptItemType::Request,
                host: target.clone(),
                method_or_status: extract_method_or_status(&decrypted_request, true),
                raw_message: decrypted_request.clone(),
                timestamp: ts_ms,
                is_https: false,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        outgoing_request_text = mod_msg;
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Request dropped by user or state shutdown for {}", request_id);
                    continue;
                }
            }
        }

        if server_stream.is_none() {
            server_stream = Some(TcpStream::connect(&target).await?);
        }
        let conn = server_stream.as_mut().unwrap();
        let start = std::time::Instant::now();

        if conn.write_all(outgoing_request_text.as_bytes()).await.is_err() {
            break;
        }

        let response_bytes = match read_full_message(conn, true).await {
            Ok(d) => d,
            Err(_) => break,
        };
        let duration = start.elapsed();
        let decrypted_response = String::from_utf8_lossy(&response_bytes).to_string();

        let mut outgoing_response_bytes = response_bytes;
        let mut final_response_text = decrypted_response.clone();

        if intercept_state.should_intercept(InterceptItemType::Response).await {
            let res_id = Uuid::new_v4().to_string();
            let item = InterceptItem {
                id: res_id.clone(),
                item_type: InterceptItemType::Response,
                host: target.clone(),
                method_or_status: extract_method_or_status(&decrypted_response, false),
                raw_message: decrypted_response.clone(),
                timestamp: now_ms(),
                is_https: false,
            };

            match intercept_state.add_and_await(item).await {
                Some(InterceptDecision::Forward { modified_message }) => {
                    if let Some(mod_msg) = modified_message {
                        final_response_text = mod_msg.clone();
                        outgoing_response_bytes = mod_msg.into_bytes();
                    }
                }
                Some(InterceptDecision::Drop) | None => {
                    tracing::info!("Response dropped by user for {}", res_id);
                    continue;
                }
            }
        }

        let history_counter: tauri::State<HistoryIdCounter> = app_handle.state();
        app_handle
            .emit(
                "http_history",
                HttpHistoryPayload {
                    id: history_counter.next(),
                    raw_request: outgoing_request_text,
                    raw_response: final_response_text,
                    host: target.clone(),
                    timestamp: ts_ms,
                    duration: Some(duration.as_millis() as u64),
                },
            )
            .ok();

        if client_stream.write_all(&outgoing_response_bytes).await.is_err() {
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

// ---------------------------------------------------------------------
// Full-message reading: reads headers, then keeps reading until the full
// body has arrived (Content-Length or chunked terminator), instead of
// relying on a single 8KB read that silently truncated anything larger.
// ---------------------------------------------------------------------

async fn read_full_message<S>(stream: &mut S, is_response: bool) -> std::io::Result<Vec<u8>>
where
    S: AsyncReadExt + Unpin,
{
    let mut data = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];

    let header_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(data); // closed before headers completed (or empty read = clean close)
        }
        data.extend_from_slice(&chunk[..n]);
        if data.len() > MAX_BODY_SIZE {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Headers exceeded max size",
            ));
        }
        if let Some(pos) = find_header_end(&data) {
            break pos;
        }
    };

    let (content_length, is_chunked) = parse_body_framing(&data[..header_end]);
    let _ = is_response; // reserved: could special-case 204/304/HEAD as bodyless

    if is_chunked {
        while !has_chunked_terminator(&data[header_end..]) {
            let n = stream.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            data.extend_from_slice(&chunk[..n]);
            if data.len() > MAX_BODY_SIZE {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Chunked body exceeded max size",
                ));
            }
        }
    } else if let Some(len) = content_length {
        let target_len = header_end + len;
        while data.len() < target_len {
            let n = stream.read(&mut chunk).await?;
            if n == 0 {
                break; // server closed early; return what we have
            }
            data.extend_from_slice(&chunk[..n]);
            if data.len() > MAX_BODY_SIZE {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Body exceeded max size",
                ));
            }
        }
    }
    // No Content-Length and not chunked: assume no body (typical for GET,
    // or a response whose body is terminated by connection close, which
    // we can't distinguish from "still coming" without more signal).

    Ok(data)
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| p + 4)
}

fn parse_body_framing(header_bytes: &[u8]) -> (Option<usize>, bool) {
    let header_str = String::from_utf8_lossy(header_bytes);
    let mut content_length = None;
    let mut is_chunked = false;

    for line in header_str.lines() {
        let lower = line.to_lowercase();
        if lower.starts_with("content-length:") {
            if let Some(v) = line.splitn(2, ':').nth(1) {
                content_length = v.trim().parse::<usize>().ok();
            }
        } else if lower.starts_with("transfer-encoding:") && lower.contains("chunked") {
            is_chunked = true;
        }
    }

    (content_length, is_chunked)
}

fn has_chunked_terminator(body: &[u8]) -> bool {
    body.windows(5).any(|w| w == b"0\r\n\r\n")
}
