//! HTTP/1.1 client connection: sends a raw request, reads back the
//! response applying RFC 7230 §3.3.3 body-framing rules, and (optionally)
//! decodes Content-Encoding.
//!
//! Split into:
//! - `tls`: TLS client config + the opt-in "accept any cert" verifier
//! - `transport`: the plain/TLS socket abstraction and connect logic
//! - `framing`: header/body boundary detection and body-framing rules
//! - `chunked`: chunked Transfer-Encoding scanning/reassembly

mod chunked;
mod framing;
mod tls;
mod transport;

use crate::ares_utils::*;
use crate::ares_utils::{
    body_decoder::DecodeLimits, http_connection::framing::parse_request_framing,
};
use anyhow::{anyhow, Result};
use chunked::dechunk_or_fallback;
use framing::{body_is_complete, locate_header_terminator, parse_response_framing, BodyFraming};
use std::time::{Duration, Instant};
use tokio::time::timeout;
use transport::connect_stream;
pub use transport::{Connection, PrefixedStream};

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
    /// Automatically decode the body's Content-Encoding as soon as the
    /// response finishes reading. Turn off for max throughput (e.g. a
    /// fuzzing loop) when you don't need decompressed bodies most of the
    /// time -- `HttpResponse::decoded` will be `None` and no decode work
    /// happens at all.
    pub auto_decode: bool,
    /// Limits passed to the decoder when `auto_decode` is true.
    pub decode_limits: DecodeLimits,
}

impl Default for ConnectionOptions {
    fn default() -> Self {
        Self {
            verify_certs: true,
            max_response_size: 50 * 1024 * 1024, // 50 MiB
            connect_timeout: Duration::from_secs(10),
            read_idle_timeout: Duration::from_secs(30),
            total_timeout: Duration::from_secs(60),
            auto_decode: true,
            decode_limits: DecodeLimits::default(),
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
    // pub is_decoded: bool,
}

impl HttpResponse {
    pub fn as_text_lossy(&self) -> String {
        format!("{}{}", self.headers, String::from_utf8_lossy(&self.body))
    }
}

pub struct HttpConnection {
    connection: Connection,
    pub host: String,
    pub port: u16,
    pub disconnected: bool,
    pub use_tls: bool,
    pub unread_buffer: Vec<u8>,
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
        let use_tls = url.starts_with("https://")
            || url.starts_with("wss://")
            || (!url.starts_with("http://") && !url.starts_with("ws://"));

        let connection = connect_stream(&host, port, use_tls, &options).await?;

        Ok(Self {
            connection,
            host,
            port,
            disconnected: false,
            use_tls,
            unread_buffer: Vec::new(),
            options,
        })
    }

    pub async fn reconnect(&mut self) -> Result<()> {
        self.connection =
            connect_stream(&self.host, self.port, self.use_tls, &self.options).await?;
        self.unread_buffer.clear();
        Ok(())
    }

    pub fn into_connection(self) -> Connection {
        self.connection
    }

    #[allow(dead_code)]
    pub fn into_parts(self) -> (Connection, Vec<u8>) {
        (self.connection, self.unread_buffer)
    }

    pub fn into_prefixed_connection(self) -> PrefixedStream<Connection> {
        PrefixedStream::new(self.unread_buffer, self.connection)
    }

    pub async fn send_request(&mut self, http_request: &[u8]) -> Result<HttpResponse> {
        self.ensure_connected().await?;

        let start = Instant::now();
        let (headers, body) = timeout(self.options.total_timeout, self.read_response(http_request))
            .await
            .map_err(|_| {
                anyhow!(
                    "request exceeded total timeout of {:?}",
                    self.options.total_timeout
                )
            })??;

        let (headers, body, _is_decoded) = if self.options.auto_decode {
            let decoded =
                body_decoder::decode_response(&headers, body, &self.options.decode_limits);
            (decoded.headers, decoded.body, true)
        } else {
            (headers, body, false)
        };

        Ok(HttpResponse {
            headers,
            body,
            // is_decoded,
            elapsed: start.elapsed(),
        })
    }

    /// Reconnects if the previous call left the connection marked dead
    /// (the peer closed it, or a prior response carried `Connection:
    /// close`). A no-op otherwise.
    async fn ensure_connected(&mut self) -> Result<()> {
        if self.disconnected {
            tracing::info!("Connection was closed by server, reconnecting...");
            self.reconnect().await?;
            self.disconnected = false;
        }
        Ok(())
    }

    /// Reads one chunk from the socket under the per-read idle timeout,
    /// collapsing the three ways a read can end (data arrived, peer
    /// closed, idle timeout) into a `ReadOutcome` so `read_response`'s loop
    /// only has to react to *what happened*, not to timeout/IO plumbing.
    async fn read_next_chunk(&mut self, chunk: &mut [u8]) -> Result<ReadOutcome> {
        match timeout(self.options.read_idle_timeout, self.connection.read(chunk)).await {
            Ok(Ok(0)) => Ok(ReadOutcome::Closed),
            Ok(Ok(n)) => Ok(ReadOutcome::Data(n)),
            Ok(Err(e)) => Err(anyhow!("Failed to read response: {}", e)),
            Err(_) => Ok(ReadOutcome::Idle),
        }
    }

    /// Sends `http_request` and reads back the full response: headers plus
    /// (unless the framing says there is none) the complete body.
    ///
    /// Per read, the pipeline is: pull bytes off the socket
    /// (`read_next_chunk`) -> once enough has arrived to see the blank
    /// line after headers, work out how the body is framed
    /// (`parse_response_framing`) -> keep reading until `body_is_complete`
    /// says the whole thing has arrived -> split headers from body and,
    /// if chunked, reassemble the payload (`dechunk_or_fallback`).
    async fn read_response(&mut self, http_request: &[u8]) -> Result<(String, Vec<u8>)> {
        self.connection.write_all(http_request).await?;

        // RFC 7230 §3.3.3: the response to a HEAD request, and any response
        // with a 1xx, 204, or 304 status, is *always* terminated by the
        // blank line after headers -- Content-Length and Transfer-Encoding
        // are ignored for framing purposes because no body is ever sent.
        let is_head_request = http_request.starts_with(b"HEAD ");

        let mut buffer: Vec<u8> = std::mem::take(&mut self.unread_buffer);
        let mut chunk = vec![0u8; 65536];

        let mut header_scan_from = 0usize;
        let mut header_end_pos = 0usize;
        let mut framing: Option<BodyFraming> = None;
        let mut chunk_cursor = 0usize; // parsed-so-far offset within the body

        loop {
            // First check if unread_buffer already contained full headers
            if framing.is_none() {
                if let Some((pos, len)) = locate_header_terminator(&buffer, &mut header_scan_from) {
                    let header_block = String::from_utf8_lossy(&buffer[..pos]);
                    let parsed = parse_response_framing(&header_block, is_head_request)?;
                    if parsed.connection_close {
                        self.disconnected = true;
                    }
                    header_end_pos = pos + len;
                    framing = Some(parsed.body_framing);
                }
            }

            if let Some(body_framing) = framing {
                if let Some(total_len) = body_is_complete(
                    &buffer,
                    header_end_pos,
                    body_framing,
                    &mut chunk_cursor,
                )? {
                    if total_len < buffer.len() {
                        self.unread_buffer = buffer[total_len..].to_vec();
                    }
                    buffer.truncate(total_len);
                    break;
                }
            }

            // Enforce the size cap before doing any more reading.
            if buffer.len() > self.options.max_response_size {
                return Err(anyhow!(
                    "response exceeded max size of {} bytes",
                    self.options.max_response_size
                ));
            }

            match self.read_next_chunk(&mut chunk).await? {
                ReadOutcome::Closed => {
                    // Server closed the connection.
                    self.disconnected = true;

                    if framing.is_none() && buffer.is_empty() {
                        return Err(anyhow!(
                            "Connection closed by server before response headers were received"
                        ));
                    }
                    if framing.is_none() {
                        return Err(anyhow!(
                            "Connection closed prematurely while reading response headers"
                        ));
                    }
                    if let Some(BodyFraming::ContentLength(expected)) = framing {
                        let actual = buffer.len().saturating_sub(header_end_pos);
                        if actual < expected {
                            return Err(anyhow!(
                                "Connection closed prematurely: expected {} body bytes, got {}",
                                expected,
                                actual
                            ));
                        }
                    }
                    if let Some(BodyFraming::Chunked) = framing {
                        return Err(anyhow!(
                            "Connection closed prematurely before chunked transfer was terminated"
                        ));
                    }
                    // For BodyFraming::UntilClose, connection close is the expected terminator!
                    break;
                }
                ReadOutcome::Data(n) => {
                    buffer.extend_from_slice(&chunk[..n]);
                }
                ReadOutcome::Idle => {
                    if matches!(framing, Some(BodyFraming::UntilClose)) && !buffer.is_empty() {
                        // For UntilClose only, an idle stall is treated as complete response
                        break;
                    }
                    return Err(anyhow!(
                        "read timed out after {:?} of inactivity",
                        self.options.read_idle_timeout
                    ));
                }
            }
        }

        let header_end = match framing {
            Some(_) => header_end_pos,
            None => buffer.len(),
        };

        let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
        let raw_body = &buffer[header_end..];

        let body = if matches!(framing, Some(BodyFraming::Chunked)) {
            dechunk_or_fallback(raw_body)
        } else {
            raw_body.to_vec()
        };

        let headers = if matches!(framing, Some(BodyFraming::Chunked | BodyFraming::UntilClose)) {
            body_decoder::rewrite_headers(&headers, body.len(), false)
        } else {
            headers
        };

        Ok((headers, body))
    }

    pub async fn close(&mut self) -> Result<()> {
        self.connection.shutdown().await?;
        self.disconnected = true;
        Ok(())
    }
}

/// Outcome of a single socket read within the per-read idle-timeout window.
enum ReadOutcome {
    /// The peer closed the connection (`read` returned 0 bytes).
    Closed,
    /// `n` new bytes were appended to the read buffer.
    Data(usize),
    /// Nothing arrived before `read_idle_timeout` elapsed.
    Idle,
}

/// Reads one full HTTP *request* off an already-accepted stream, writing
/// nothing first -- the mirror image of `read_response`, for a server
/// (e.g. the proxy's listener) instead of a client. Shares the same
/// size-cap/framing/dechunk machinery `read_response` uses, via
/// `parse_request_framing` and `body_is_complete`.
///
/// `keep_alive_idle_timeout` governs the wait for the *first* byte of a
/// new request on a reused connection -- deliberately separate from
/// `options.read_idle_timeout`, which only kicks in once a request has
/// started arriving (mid-message stalls, i.e. slowloris protection).
/// `options.total_timeout` is enforced from the moment the first byte of
/// the request arrives, same as `send_request` enforces it from the
/// moment a response starts arriving.
///
/// Returns an empty `Vec` if the connection closes (or the keep-alive
/// wait times out) before any bytes of a new request arrive -- callers
/// should treat that as "nothing more to read," not an error.
pub async fn read_request_message<S>(
    stream: &mut S,
    options: &ConnectionOptions,
    keep_alive_idle_timeout: Duration,
    carry_over: &mut Vec<u8>,
) -> Result<Vec<u8>>
where
    S: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    let mut buffer: Vec<u8> = std::mem::take(carry_over);
    let mut chunk = vec![0u8; 65536];
    let mut header_scan_from = 0usize;
    let mut header_end_pos = 0usize;
    let mut framing: Option<BodyFraming> = None;
    let mut chunk_cursor = 0usize;
    let mut message_started_at: Option<Instant> = if !buffer.is_empty() {
        Some(Instant::now())
    } else {
        None
    };

    loop {
        if framing.is_none() {
            if let Some((pos, len)) = locate_header_terminator(&buffer, &mut header_scan_from) {
                let header_block = String::from_utf8_lossy(&buffer[..pos]);
                let parsed = parse_request_framing(&header_block)?;
                header_end_pos = pos + len;
                framing = Some(parsed.body_framing);
            }
        }

        if let Some(body_framing) = framing {
            if let Some(total_len) =
                body_is_complete(&buffer, header_end_pos, body_framing, &mut chunk_cursor)?
            {
                if total_len < buffer.len() {
                    *carry_over = buffer[total_len..].to_vec();
                }
                buffer.truncate(total_len);
                break;
            }
        }

        if buffer.len() > options.max_response_size {
            return Err(anyhow!(
                "request exceeded max size of {} bytes",
                options.max_response_size
            ));
        }

        if let Some(started) = message_started_at {
            if started.elapsed() > options.total_timeout {
                return Err(anyhow!(
                    "request exceeded total timeout of {:?}",
                    options.total_timeout
                ));
            }
        }

        let idle_budget = if buffer.is_empty() {
            keep_alive_idle_timeout
        } else {
            options.read_idle_timeout
        };

        let outcome = match timeout(idle_budget, stream.read(&mut chunk)).await {
            Ok(Ok(0)) => ReadOutcome::Closed,
            Ok(Ok(n)) => ReadOutcome::Data(n),
            Ok(Err(e)) => return Err(anyhow!("Failed to read request: {}", e)),
            Err(_) => ReadOutcome::Idle,
        };

        match outcome {
            ReadOutcome::Closed => break,
            ReadOutcome::Data(n) => {
                if message_started_at.is_none() {
                    message_started_at = Some(Instant::now());
                }
                buffer.extend_from_slice(&chunk[..n]);
            }
            ReadOutcome::Idle => {
                if buffer.is_empty() {
                    // Keep-alive wait timed out with nothing arriving --
                    // treat like a clean close, not an error.
                    return Ok(Vec::new());
                }
                return Err(anyhow!(
                    "request read timed out after {:?} of inactivity",
                    options.read_idle_timeout
                ));
            }
        }
    }

    if buffer.is_empty() {
        return Ok(Vec::new());
    }

    let header_end = match framing {
        Some(_) => header_end_pos,
        None => buffer.len(),
    };

    let raw_body = &buffer[header_end..];
    let body = if matches!(framing, Some(BodyFraming::Chunked)) {
        dechunk_or_fallback(raw_body)
    } else {
        raw_body.to_vec()
    };

    // If the request was chunked, rewrite headers to replace Transfer-Encoding: chunked
    // with Content-Length: body.len() so upstream origin gets valid HTTP/1.1 framing
    let full = if matches!(framing, Some(BodyFraming::Chunked)) {
        let headers_str = String::from_utf8_lossy(&buffer[..header_end]);
        let rewritten = body_decoder::rewrite_headers(&headers_str, body.len(), false);
        let mut f = rewritten.into_bytes();
        f.extend_from_slice(&body);
        f
    } else {
        let mut f = buffer[..header_end].to_vec();
        f.extend_from_slice(&body);
        f
    };

    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[tokio::test]
    async fn test_read_request_message_with_carry_over_and_excess() {
        let options = ConnectionOptions::default();
        let mut carry_over = b"GET /first HTTP/1.1\r\nHost: example.com\r\nContent-Length: 5\r\n\r\nhelloPOST /sec".to_vec();
        let mut conn = Cursor::new(b"ond HTTP/1.1\r\nHost: example.com\r\nContent-Length: 4\r\n\r\nwork".to_vec());

        let req1 = read_request_message(&mut conn, &options, options.read_idle_timeout, &mut carry_over).await.unwrap();
        let req1_str = String::from_utf8(req1).unwrap();
        assert!(req1_str.starts_with("GET /first HTTP/1.1"));
        assert!(req1_str.ends_with("hello"));

        // carry_over should now contain the start of the second request
        assert_eq!(&carry_over, b"POST /sec");

        let req2 = read_request_message(&mut conn, &options, options.read_idle_timeout, &mut carry_over).await.unwrap();
        let req2_str = String::from_utf8(req2).unwrap();
        assert!(req2_str.starts_with("POST /second HTTP/1.1"));
        assert!(req2_str.ends_with("work"));
        assert!(carry_over.is_empty());
    }

    #[tokio::test]
    async fn test_read_request_message_chunked_rewrites_headers() {
        let options = ConnectionOptions::default();
        let mut carry_over = Vec::new();
        let raw_chunked = b"POST /api HTTP/1.1\r\nHost: example.com\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        let mut conn = Cursor::new(raw_chunked.to_vec());

        let req = read_request_message(&mut conn, &options, options.read_idle_timeout, &mut carry_over).await.unwrap();
        let req_str = String::from_utf8(req).unwrap();
        assert!(req_str.starts_with("POST /api HTTP/1.1"));
        assert!(req_str.contains("Content-Length: 11"));
        assert!(!req_str.to_lowercase().contains("transfer-encoding"));
        assert!(req_str.ends_with("hello world"));
    }
}

