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
pub use transport::Connection;

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
            options,
        })
    }

    pub async fn reconnect(&mut self) -> Result<()> {
        self.connection =
            connect_stream(&self.host, self.port, self.use_tls, &self.options).await?;
        Ok(())
    }

    pub fn into_connection(self) -> Connection {
        self.connection
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
        // Without this, a HEAD response carrying a Content-Length copied
        // from the equivalent GET (very common) would make us sit here
        // waiting for body bytes that are never coming, until the idle/
        // total timeout eventually fires.
        let is_head_request = http_request.starts_with(b"HEAD ");

        let mut buffer: Vec<u8> = Vec::with_capacity(65536);
        let mut chunk = vec![0u8; 65536];

        let mut header_scan_from = 0usize;
        let mut header_end_pos = 0usize;
        let mut framing: Option<BodyFraming> = None;
        let mut chunk_cursor = 0usize; // parsed-so-far offset within the body

        loop {
            // Enforce the size cap before doing any more reading.
            if buffer.len() > self.options.max_response_size {
                return Err(anyhow!(
                    "response exceeded max size of {} bytes",
                    self.options.max_response_size
                ));
            }

            match self.read_next_chunk(&mut chunk).await? {
                ReadOutcome::Closed => {
                    // Server closed the connection. Whether or not it sent
                    // Connection: close, the socket is now dead -- mark it
                    // so the next call reconnects instead of writing to a
                    // closed stream.
                    self.disconnected = true;
                    break;
                }
                ReadOutcome::Data(n) => {
                    buffer.extend_from_slice(&chunk[..n]);

                    if framing.is_none() {
                        if let Some(pos) = locate_header_terminator(&buffer, &mut header_scan_from)
                        {
                            let header_block = String::from_utf8_lossy(&buffer[..pos]);
                            let parsed = parse_response_framing(&header_block, is_head_request)?;
                            if parsed.connection_close {
                                self.disconnected = true;
                            }
                            header_end_pos = pos + 4;
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
                            buffer.truncate(total_len);
                            break;
                        }
                    }
                }
                ReadOutcome::Idle => {
                    if framing.is_some() && !buffer.is_empty() {
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

        let header_end = match framing {
            Some(_) => header_end_pos,
            // Connection closed before headers finished -- treat everything
            // received as headers so callers can still see what came back.
            None => buffer.len(),
        };

        let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
        let raw_body = &buffer[header_end..];

        // body_is_complete (via scan_chunked_body) only located *where* the
        // chunked message ends; still need to strip the chunk-size
        // lines/CRLFs/trailers and reassemble the actual payload.
        let body = if matches!(framing, Some(BodyFraming::Chunked)) {
            dechunk_or_fallback(raw_body)
        } else {
            raw_body.to_vec()
        };

        // If the response body was chunked or framed until connection close,
        // rewrite headers to drop Transfer-Encoding and enforce Content-Length matching body.len().
        // Content-Encoding is left intact if auto_decode is false.
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
) -> Result<Vec<u8>>
where
    S: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    let mut buffer: Vec<u8> = Vec::with_capacity(65536);
    let mut chunk = vec![0u8; 65536];
    let mut header_scan_from = 0usize;
    let mut header_end_pos = 0usize;
    let mut framing: Option<BodyFraming> = None;
    let mut chunk_cursor = 0usize;
    let mut message_started_at: Option<Instant> = None;

    loop {
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

                if framing.is_none() {
                    if let Some(pos) = locate_header_terminator(&buffer, &mut header_scan_from) {
                        let header_block = String::from_utf8_lossy(&buffer[..pos]);
                        let parsed = parse_request_framing(&header_block)?;
                        header_end_pos = pos + 4;
                        framing = Some(parsed.body_framing);
                        // parsed.connection_close is available here if the
                        // proxy ever wants to honor a client-sent
                        // `Connection: close` on the inbound leg; unused
                        // for now since tunnel lifetime is driven by the
                        // accept loop, not this reader.
                    }
                }

                if let Some(body_framing) = framing {
                    if let Some(total_len) =
                        body_is_complete(&buffer, header_end_pos, body_framing, &mut chunk_cursor)?
                    {
                        buffer.truncate(total_len);
                        break;
                    }
                }
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
                // note: request framing never produces BodyFraming::UntilClose,
                // so unlike read_response there's no "idle + framing.is_some()
                // => treat as complete" branch needed here.
            }
        }
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

    let mut full = buffer[..header_end].to_vec();
    full.extend_from_slice(&body);
    Ok(full)
}
