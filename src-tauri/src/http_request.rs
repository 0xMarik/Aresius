use crate::ares_utils::*;
use anyhow::{anyhow, Result};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use tokio_rustls::TlsConnector;

/// Verifier that accepts any certificate presented by the server.
///
/// This exists because Aresius is a pentest/interception proxy that has to
/// be able to reach targets with self-signed, expired, or hostname-mismatched
/// certificates. It must only be used when the caller has explicitly opted
/// into `verify_certs: false` (e.g. a "trust this target anyway" toggle in
/// the UI) -- never as a silent default.
#[derive(Debug)]
struct NoCertVerification;

impl ServerCertVerifier for NoCertVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, tokio_rustls::rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA1,
            SignatureScheme::ECDSA_SHA1_Legacy,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

/// Builds (once per process, per verification mode) the rustls `ClientConfig`
/// used for outbound TLS connections. Loading the platform root store is a
/// blocking syscall and was previously repeated on every single connection
/// and reconnection -- this caches it instead.
fn build_tls_config(verify_certs: bool) -> Result<Arc<ClientConfig>> {
    let mut config = if verify_certs {
        let mut root_store = RootCertStore::empty();
        let native_certs = rustls_native_certs::load_native_certs();

        if !native_certs.errors.is_empty() {
            eprintln!(
                "warning: {} error(s) while loading platform root certificates",
                native_certs.errors.len()
            );
        }

        let mut failed = 0usize;
        for cert in native_certs.certs {
            if root_store.add(cert).is_err() {
                failed += 1;
            }
        }
        if failed > 0 {
            eprintln!(
                "warning: {} platform root certificate(s) could not be added to the trust store",
                failed
            );
        }
        if root_store.is_empty() {
            return Err(anyhow!(
                "no usable platform root certificates were found; TLS connections will fail"
            ));
        }

        ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth()
    } else {
        ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertVerification))
            .with_no_client_auth()
    };

    // Force HTTP/1.1 so this hand-rolled parser never has to deal with a
    // server that decided to negotiate something else via ALPN.
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

    Ok(Arc::new(config))
}

/// Returns the cached TLS config for the given verification mode, building
/// it on first use. A benign race where two callers both build it on first
/// use is possible but harmless -- the result is deterministic and this only
/// happens once per mode, not per connection.
fn get_tls_config(verify_certs: bool) -> Result<Arc<ClientConfig>> {
    static VERIFIED: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    static INSECURE: OnceLock<Arc<ClientConfig>> = OnceLock::new();

    let cell = if verify_certs { &VERIFIED } else { &INSECURE };
    if let Some(cfg) = cell.get() {
        return Ok(cfg.clone());
    }
    let cfg = build_tls_config(verify_certs)?;
    let _ = cell.set(cfg.clone());
    Ok(cell.get().expect("just set").clone())
}

enum Connection {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

impl Connection {
    async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        match self {
            Connection::Plain(stream) => stream.write_all(buf).await,
            Connection::Tls(stream) => stream.write_all(buf).await,
        }
    }

    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Connection::Plain(stream) => stream.read(buf).await,
            Connection::Tls(stream) => stream.read(buf).await,
        }
    }

    async fn shutdown(&mut self) -> std::io::Result<()> {
        match self {
            Connection::Plain(stream) => stream.shutdown().await,
            Connection::Tls(stream) => stream.shutdown().await,
        }
    }
}

/// Tunables for a connection. Defaults are conservative for talking to
/// arbitrary (including hostile/misbehaving) targets during fuzzing or
/// proxying, which is the primary use case here.
#[derive(Clone, Debug)]
pub struct ConnectionOptions {
    /// Verify the server's TLS certificate against the platform root store.
    /// Set to `false` to reach targets with self-signed/expired/mismatched
    /// certs (common in pentest targets) -- surface this as an explicit
    /// opt-in in the UI, never as a silent default.
    pub verify_certs: bool,
    /// Hard cap on total response size (headers + body). Protects against
    /// memory exhaustion from a huge/infinite Content-Length or an endless
    /// chunked stream.
    pub max_response_size: usize,
    /// Timeout for the initial TCP connect.
    pub connect_timeout: Duration,
    /// Per-read idle timeout: how long we'll wait for *any* new bytes
    /// before giving up.
    pub read_idle_timeout: Duration,
    /// Overall wall-clock budget for a single request/response cycle, so a
    /// slowloris-style target trickling bytes just under the idle timeout
    /// can't hang a request indefinitely.
    pub total_timeout: Duration,
}

impl Default for ConnectionOptions {
    fn default() -> Self {
        Self {
            verify_certs: true,
            max_response_size: 50 * 1024 * 1024, // 50 MiB
            connect_timeout: Duration::from_secs(10),
            read_idle_timeout: Duration::from_secs(30),
            total_timeout: Duration::from_secs(60),
        }
    }
}

/// A parsed HTTP response. Body is kept as raw bytes rather than lossily
/// converted to a `String`, since responses (images, compressed bodies,
/// arbitrary binary APIs) are frequently not valid UTF-8 and this is a tool
/// that has to reproduce bytes exactly for diffing/replay.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    /// Raw status line + headers, up to and including the blank line.
    /// Headers are effectively guaranteed ASCII by the HTTP spec, so a
    /// lossy conversion here is safe (unlike the body).
    pub headers: String,
    pub body: Vec<u8>,
    pub elapsed: Duration,
}

impl HttpResponse {
    /// Full raw response bytes (headers + body), for exact replay/diffing.
    // pub fn raw_bytes(&self) -> Vec<u8> {
    //     let mut out = self.headers.clone().into_bytes();
    //     out.extend_from_slice(&self.body);
    //     out
    // }

    /// Lossy text view of the entire response, for display purposes only --
    /// not safe to use where byte-exact content matters.
    pub fn as_text_lossy(&self) -> String {
        format!("{}{}", self.headers, String::from_utf8_lossy(&self.body))
    }
}

pub struct HttpConnection {
    connection: Connection,
    host: String,
    port: u16,
    disconnected: bool,
    use_tls: bool,
    options: ConnectionOptions,
}

impl HttpConnection {
    pub async fn new(url: &str) -> Result<Self> {
        Self::with_options(url, ConnectionOptions::default()).await
    }

    pub async fn with_options(url: &str, options: ConnectionOptions) -> Result<Self> {
        let url_component = url_parsing(url).ok_or_else(|| anyhow!("URL parsing failed"))?;

        let host = url_component.domain;
        let port = url_component.port;
        let use_tls = url.starts_with("https://");

        let connection = connect_stream(&host, port, use_tls, &options).await?;

        Ok(Self {
            connection,
            host,
            port,
            disconnected: false,
            use_tls,
            options,
        })
    }

    async fn reconnect(&mut self) -> Result<()> {
        self.connection =
            connect_stream(&self.host, self.port, self.use_tls, &self.options).await?;
        Ok(())
    }

    pub async fn send_request(&mut self, http_request: &str) -> Result<HttpResponse> {
        if self.disconnected {
            tracing::info!("Connection was closed by server, reconnecting...");
            self.reconnect().await?;
            self.disconnected = false;
        }

        let start = Instant::now();
        let result = timeout(self.options.total_timeout, self.read_response(http_request))
            .await
            .map_err(|_| {
                anyhow!(
                    "request exceeded total timeout of {:?}",
                    self.options.total_timeout
                )
            })?;

        result.map(|(headers, body)| HttpResponse {
            headers,
            body,
            elapsed: start.elapsed(),
        })
    }

    async fn read_response(&mut self, http_request: &str) -> Result<(String, Vec<u8>)> {
        self.connection.write_all(http_request.as_bytes()).await?;

        // RFC 7230 §3.3.3: the response to a HEAD request, and any response
        // with a 1xx, 204, or 304 status, is *always* terminated by the
        // blank line after headers -- Content-Length and Transfer-Encoding
        // are ignored for framing purposes because no body is ever sent.
        // Without this, a HEAD response carrying a Content-Length copied
        // from the equivalent GET (very common) would make us sit here
        // waiting for body bytes that are never coming, until the idle/
        // total timeout eventually fires.
        let is_head_request = http_request
            .split_whitespace()
            .next()
            .map(|m| m.eq_ignore_ascii_case("HEAD"))
            .unwrap_or(false);

        let mut buffer: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 4096];

        let mut headers_complete = false;
        let mut header_end_pos = 0usize;
        let mut header_scan_from = 0usize;

        let mut content_length: Option<usize> = None;
        let mut is_chunked = false;
        let mut chunk_cursor = 0usize; // parsed-so-far offset within the body
        let mut no_body_response = false;

        loop {
            // Enforce the size cap before doing any more reading.
            if buffer.len() > self.options.max_response_size {
                return Err(anyhow!(
                    "response exceeded max size of {} bytes",
                    self.options.max_response_size
                ));
            }

            match timeout(
                self.options.read_idle_timeout,
                self.connection.read(&mut chunk),
            )
            .await
            {
                Ok(Ok(0)) => {
                    // Server closed the connection. Whether or not it sent
                    // Connection: close, the socket is now dead -- mark it
                    // so the next call reconnects instead of writing to a
                    // closed stream.
                    self.disconnected = true;
                    break;
                }
                Ok(Ok(n)) => {
                    buffer.extend_from_slice(&chunk[..n]);

                    if !headers_complete {
                        // Only scan the newly-arrived region (plus a small
                        // overlap in case "\r\n\r\n" straddled a read
                        // boundary) instead of re-scanning the whole buffer
                        // every time.
                        let scan_start = header_scan_from.saturating_sub(3);
                        if let Some(rel_pos) = find_subslice(&buffer[scan_start..], b"\r\n\r\n") {
                            let pos = scan_start + rel_pos;
                            headers_complete = true;
                            header_end_pos = pos + 4;

                            let header_str = String::from_utf8_lossy(&buffer[..pos]);

                            let status_code: Option<u16> = header_str
                                .lines()
                                .next()
                                .and_then(|status_line| status_line.split_whitespace().nth(1))
                                .and_then(|code_str| code_str.parse().ok());
                            let is_no_body_status =
                                matches!(status_code, Some(100..=199) | Some(204) | Some(304));
                            no_body_response = is_head_request || is_no_body_status;

                            for line in header_str.lines() {
                                let line_lower = line.to_lowercase();
                                if let Some(value) = line_lower.strip_prefix("connection:") {
                                    if value.contains("close") {
                                        self.disconnected = true;
                                    }
                                } else if let Some(value) =
                                    line_lower.strip_prefix("transfer-encoding:")
                                {
                                    if value.contains("chunked") {
                                        is_chunked = true;
                                    }
                                } else if let Some(value) =
                                    line_lower.strip_prefix("content-length:")
                                {
                                    let parsed: usize = value
                                        .trim()
                                        .parse()
                                        .map_err(|_| anyhow!("invalid Content-Length header"))?;
                                    if let Some(existing) = content_length {
                                        if existing != parsed {
                                            // Conflicting Content-Length values are a classic
                                            // request/response-smuggling smell -- refuse to
                                            // silently pick one.
                                            return Err(anyhow!(
                                                "conflicting Content-Length headers ({} vs {})",
                                                existing,
                                                parsed
                                            ));
                                        }
                                    }
                                    content_length = Some(parsed);
                                }
                            }

                            if !no_body_response && is_chunked && content_length.is_some() {
                                // RFC 7230 §3.3.3: a message with both is
                                // smuggling-ambiguous; Transfer-Encoding wins,
                                // but flag it rather than parse silently.
                                eprintln!(
                                    "warning: response has both Content-Length and \
                                     chunked Transfer-Encoding; treating as chunked"
                                );
                                content_length = None;
                            }
                        } else {
                            header_scan_from = buffer.len();
                        }
                    }

                    if headers_complete {
                        if no_body_response {
                            // Ignore whatever Content-Length/Transfer-Encoding
                            // claimed -- there is no body to wait for. Drop
                            // anything already buffered past the headers
                            // (there shouldn't be any in practice) so we
                            // don't accidentally attribute stray bytes to
                            // this response.
                            buffer.truncate(header_end_pos);
                            break;
                        } else if is_chunked {
                            let body = &buffer[header_end_pos..];
                            match scan_chunked_body(body, &mut chunk_cursor)? {
                                Some(total_len) => {
                                    buffer.truncate(header_end_pos + total_len);
                                    break;
                                }
                                None => continue,
                            }
                        } else if let Some(expected_len) = content_length {
                            let body_len = buffer.len() - header_end_pos;
                            if body_len >= expected_len {
                                buffer.truncate(header_end_pos + expected_len);
                                break;
                            }
                        } else {
                            // No Content-Length, not chunked: body is
                            // delimited by connection close (HTTP/1.0-style).
                            // Keep reading until EOF.
                        }
                    }
                }
                Ok(Err(e)) => return Err(anyhow!("Failed to read response: {}", e)),
                Err(_) => {
                    if headers_complete && !buffer.is_empty() {
                        // No Content-Length/chunked info and the peer went
                        // idle -- treat what we have as the full response.
                        break;
                    }
                    return Err(anyhow!(
                        "read timed out after {:?} of inactivity",
                        self.options.read_idle_timeout
                    ));
                }
            }
        }

        let header_end = if headers_complete {
            header_end_pos
        } else {
            // Connection closed before headers finished -- treat everything
            // received as headers so callers can still see what came back.
            buffer.len()
        };

        let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
        let raw_body = &buffer[header_end..];

        let body = if is_chunked && headers_complete {
            // scan_chunked_body only located where the chunked message ends;
            // still need to strip the chunk-size lines/CRLFs/trailers and
            // reassemble the actual payload.
            match dechunk(raw_body) {
                Ok(decoded) => decoded,
                Err(e) => {
                    // Most likely the connection was closed mid-stream
                    // before the terminator was reached. Surface what we
                    // have rather than discarding it entirely.
                    eprintln!(
                        "warning: could not fully decode chunked body ({}), returning raw bytes",
                        e
                    );
                    raw_body.to_vec()
                }
            }
        } else {
            raw_body.to_vec()
        };

        Ok((headers, body))
    }

    pub async fn close(&mut self) -> Result<()> {
        self.connection.shutdown().await?;
        self.disconnected = true;
        Ok(())
    }
}

async fn connect_stream(
    host: &str,
    port: u16,
    use_tls: bool,
    options: &ConnectionOptions,
) -> Result<Connection> {
    let addr = format!("{}:{}", host, port);
    let tcp_stream = timeout(options.connect_timeout, TcpStream::connect(&addr))
        .await
        .map_err(|_| {
            anyhow!(
                "connect to {} timed out after {:?}",
                addr,
                options.connect_timeout
            )
        })??;

    if !use_tls {
        return Ok(Connection::Plain(tcp_stream));
    }

    let config = get_tls_config(options.verify_certs)?;
    let connector = TlsConnector::from(config);
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|_| anyhow!("Invalid DNS name: {}", host))?;

    let tls_stream = connector.connect(server_name, tcp_stream).await?;
    Ok(Connection::Tls(Box::new(tls_stream)))
}

/// Incrementally scans `body` (the bytes received so far after the HTTP
/// headers) for a complete chunked-transfer-encoded message.
///
/// `cursor` tracks how many bytes of `body` have already been structurally
/// parsed as complete chunks, so repeated calls as more data streams in only
/// do work on the newly-arrived tail instead of re-parsing from the start
/// every time.
///
/// Returns `Ok(Some(total_len))` once the terminating chunk (`0` size, plus
/// any trailer headers and the final blank line) has been fully received,
/// where `total_len` is the length of `body` that makes up the complete
/// chunked message. Returns `Ok(None)` if more data is needed.
fn scan_chunked_body(body: &[u8], cursor: &mut usize) -> Result<Option<usize>> {
    loop {
        if *cursor > body.len() {
            return Ok(None);
        }
        let remaining = &body[*cursor..];

        let line_end = match find_subslice(remaining, b"\r\n") {
            Some(i) => i,
            None => {
                if remaining.len() > 128 {
                    return Err(anyhow!("malformed or oversized chunk size line"));
                }
                return Ok(None);
            }
        };

        let size_line = &remaining[..line_end];
        // Chunk extensions ("<size>;name=value") are legal; ignore them.
        let size_bytes = size_line.split(|&b| b == b';').next().unwrap_or(size_line);
        let size_str = std::str::from_utf8(size_bytes)
            .map_err(|_| anyhow!("invalid chunk size encoding"))?
            .trim();
        if size_str.is_empty() {
            return Err(anyhow!("empty chunk size line"));
        }
        let chunk_size = usize::from_str_radix(size_str, 16)
            .map_err(|_| anyhow!("invalid chunk size: {:?}", size_str))?;

        let after_size_line = *cursor + line_end + 2;

        if chunk_size == 0 {
            let trailer_region = &body[after_size_line..];
            if trailer_region.len() >= 2 && &trailer_region[..2] == b"\r\n" {
                return Ok(Some(after_size_line + 2));
            }
            if let Some(trailer_end) = find_subslice(trailer_region, b"\r\n\r\n") {
                return Ok(Some(after_size_line + trailer_end + 4));
            }
            return Ok(None);
        }

        let data_end = match after_size_line.checked_add(chunk_size) {
            Some(v) => v,
            None => return Err(anyhow!("chunk size overflow")),
        };
        let needed = data_end + 2; // trailing CRLF after chunk data
        if body.len() < needed {
            return Ok(None);
        }
        if &body[data_end..needed] != b"\r\n" {
            return Err(anyhow!("malformed chunk terminator"));
        }

        *cursor = needed;
        // Try to parse the next chunk with whatever data we already have.
    }
}

/// Strips chunk-size lines, extensions, inter-chunk CRLFs, and trailers from
/// a complete chunked-transfer-encoded body, returning just the reassembled
/// payload bytes. Expects `body` to already be a complete chunked message as
/// confirmed by `scan_chunked_body` (i.e. ending in a `0` chunk followed by
/// the trailer terminator).
fn dechunk(body: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(body.len());
    let mut pos = 0usize;

    loop {
        let remaining = body
            .get(pos..)
            .ok_or_else(|| anyhow!("chunk cursor past end of body"))?;
        let line_end = find_subslice(remaining, b"\r\n")
            .ok_or_else(|| anyhow!("truncated chunk size line"))?;

        let size_line = &remaining[..line_end];
        let size_bytes = size_line.split(|&b| b == b';').next().unwrap_or(size_line);
        let size_str = std::str::from_utf8(size_bytes)
            .map_err(|_| anyhow!("invalid chunk size encoding"))?
            .trim();
        let chunk_size = usize::from_str_radix(size_str, 16)
            .map_err(|_| anyhow!("invalid chunk size: {:?}", size_str))?;

        let data_start = pos + line_end + 2;
        if chunk_size == 0 {
            // Trailers (if any) and the final blank line follow; nothing
            // further to append to the decoded body.
            break;
        }

        let data_end = data_start
            .checked_add(chunk_size)
            .ok_or_else(|| anyhow!("chunk size overflow"))?;
        let data = body
            .get(data_start..data_end)
            .ok_or_else(|| anyhow!("chunk data runs past end of body"))?;
        out.extend_from_slice(data);

        pos = data_end + 2; // skip the CRLF that follows each chunk's data
    }

    Ok(out)
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}
