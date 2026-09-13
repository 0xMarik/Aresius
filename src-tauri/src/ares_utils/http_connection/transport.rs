//! The raw plain/TLS socket abstraction (`Connection`) and the connect
//! logic that produces one.

use super::tls::get_tls_config;
use super::ConnectionOptions;
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::TlsConnector;

const DNS_CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes

struct DnsCache {
    entries: RwLock<HashMap<String, (Vec<SocketAddr>, Instant)>>,
}

impl DnsCache {
    fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    fn global() -> &'static DnsCache {
        static CACHE: OnceLock<DnsCache> = OnceLock::new();
        CACHE.get_or_init(DnsCache::new)
    }

    fn get(&self, host: &str, port: u16) -> Option<Vec<SocketAddr>> {
        let key = format!("{}:{}", host, port);
        let guard = self.entries.read().ok()?;
        if let Some((addrs, expires_at)) = guard.get(&key) {
            if Instant::now() < *expires_at {
                return Some(addrs.clone());
            }
        }
        None
    }

    fn insert(&self, host: &str, port: u16, addrs: Vec<SocketAddr>) {
        let key = format!("{}:{}", host, port);
        if let Ok(mut guard) = self.entries.write() {
            guard.insert(key, (addrs, Instant::now() + DNS_CACHE_TTL));
        }
    }

    fn invalidate(&self, host: &str, port: u16) {
        let key = format!("{}:{}", host, port);
        if let Ok(mut guard) = self.entries.write() {
            guard.remove(&key);
        }
    }
}

/// Resolves `host:port` to a list of socket addresses with DNS caching
/// and IPv4 prioritization (to avoid Windows IPv6 resolution / connect hangs).
async fn resolve_host(host: &str, port: u16, allow_cache: bool) -> Result<(Vec<SocketAddr>, bool)> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok((vec![SocketAddr::new(ip, port)], false));
    }

    if allow_cache {
        if let Some(cached) = DnsCache::global().get(host, port) {
            return Ok((cached, true));
        }
    }

    let addr_str = format!("{}:{}", host, port);
    let resolved = tokio::net::lookup_host(&addr_str)
        .await
        .map_err(|e| anyhow!("DNS resolution failed for {}: {}", addr_str, e))?;

    let mut addrs: Vec<SocketAddr> = resolved.collect();
    if addrs.is_empty() {
        return Err(anyhow!("No IP addresses found for {}", addr_str));
    }

    // Prioritize IPv4 over IPv6 to avoid Windows dual-stack / blackholed IPv6 delays
    addrs.sort_by_key(|addr| if addr.is_ipv4() { 0 } else { 1 });

    DnsCache::global().insert(host, port, addrs.clone());
    Ok((addrs, false))
}

async fn connect_tcp(addrs: &[SocketAddr], connect_timeout: Duration) -> Result<TcpStream> {
    let mut last_err = None;
    for addr in addrs {
        // Use a per-address timeout if multiple exist, or full timeout if single
        let per_addr_timeout = if addrs.len() > 1 {
            connect_timeout.min(Duration::from_secs(3))
        } else {
            connect_timeout
        };

        match timeout(per_addr_timeout, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => {
                let _ = stream.set_nodelay(true);
                return Ok(stream);
            }
            Ok(Err(e)) => {
                last_err = Some(anyhow!("Connect to {} failed: {}", addr, e));
            }
            Err(_) => {
                last_err = Some(anyhow!("Connect to {} timed out after {:?}", addr, per_addr_timeout));
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow!("No reachable socket address")))
}

/// A connected socket, either plaintext or wrapped in TLS. Lets the rest of
/// `HttpConnection` read/write without caring which one it has.
pub enum Connection {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

impl tokio::io::AsyncRead for Connection {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            Connection::Plain(stream) => std::pin::Pin::new(stream).poll_read(cx, buf),
            Connection::Tls(stream) => std::pin::Pin::new(stream.as_mut()).poll_read(cx, buf),
        }
    }
}

impl tokio::io::AsyncWrite for Connection {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Connection::Plain(stream) => std::pin::Pin::new(stream).poll_write(cx, buf),
            Connection::Tls(stream) => std::pin::Pin::new(stream.as_mut()).poll_write(cx, buf),
        }
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            Connection::Plain(stream) => std::pin::Pin::new(stream).poll_flush(cx),
            Connection::Tls(stream) => std::pin::Pin::new(stream.as_mut()).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            Connection::Plain(stream) => std::pin::Pin::new(stream).poll_shutdown(cx),
            Connection::Tls(stream) => std::pin::Pin::new(stream.as_mut()).poll_shutdown(cx),
        }
    }
}

impl Connection {
    pub async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        match self {
            Connection::Plain(stream) => stream.write_all(buf).await,
            Connection::Tls(stream) => stream.write_all(buf).await,
        }
    }

    pub async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Connection::Plain(stream) => stream.read(buf).await,
            Connection::Tls(stream) => stream.read(buf).await,
        }
    }

    pub async fn shutdown(&mut self) -> std::io::Result<()> {
        match self {
            Connection::Plain(stream) => stream.shutdown().await,
            Connection::Tls(stream) => stream.shutdown().await,
        }
    }
}

const MAX_CONNECT_RETRIES: usize = 3;

/// Opens a TCP connection to `host:port`, wrapping it in TLS when `use_tls`
/// is set. Timeouts, DNS caching, and cert-verification behavior come from `options`.
/// Includes automatic retries with exponential backoff and DNS cache invalidation on TLS handshake failures / resets.
pub(super) async fn connect_stream(
    host: &str,
    port: u16,
    use_tls: bool,
    options: &ConnectionOptions,
) -> Result<Connection> {
    let mut last_err = None;

    for attempt in 0..MAX_CONNECT_RETRIES {
        let allow_cache = attempt == 0;
        let (addrs, from_cache) = match resolve_host(host, port, allow_cache).await {
            Ok(res) => res,
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        };

        let tcp_stream = match connect_tcp(&addrs, options.connect_timeout).await {
            Ok(stream) => stream,
            Err(_e) if from_cache => {
                // Invalidate stale DNS cache and retry fresh lookup
                tracing::debug!("Cached DNS failed for {}:{}, re-resolving...", host, port);
                DnsCache::global().invalidate(host, port);
                match resolve_host(host, port, false).await {
                    Ok((fresh_addrs, _)) => match connect_tcp(&fresh_addrs, options.connect_timeout).await {
                        Ok(stream) => stream,
                        Err(fresh_err) => {
                            last_err = Some(fresh_err);
                            if attempt + 1 < MAX_CONNECT_RETRIES {
                                let backoff_ms = (50 * (1 << attempt)).min(500);
                                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                            }
                            continue;
                        }
                    },
                    Err(dns_err) => {
                        last_err = Some(dns_err);
                        continue;
                    }
                }
            }
            Err(e) => {
                last_err = Some(e);
                if attempt + 1 < MAX_CONNECT_RETRIES {
                    let backoff_ms = (50 * (1 << attempt)).min(500);
                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                }
                continue;
            }
        };

        if !use_tls {
            return Ok(Connection::Plain(tcp_stream));
        }

        let config = match get_tls_config(options.verify_certs) {
            Ok(cfg) => cfg,
            Err(e) => return Err(e),
        };
        let connector = TlsConnector::from(config);
        let server_name = match ServerName::try_from(host.to_string()) {
            Ok(sn) => sn,
            Err(_) => return Err(anyhow!("Invalid DNS name: {}", host)),
        };

        let handshake_timeout = options.connect_timeout.min(Duration::from_secs(5));
        match timeout(handshake_timeout, connector.connect(server_name, tcp_stream)).await {
            Ok(Ok(tls_stream)) => return Ok(Connection::Tls(Box::new(tls_stream))),
            Ok(Err(e)) => {
                tracing::warn!(
                    "TLS handshake to {}:{} failed (attempt {}/{}): {}",
                    host,
                    port,
                    attempt + 1,
                    MAX_CONNECT_RETRIES,
                    e
                );
                DnsCache::global().invalidate(host, port);
                last_err = Some(anyhow!("TLS handshake failed: {}", e));
            }
            Err(_) => {
                tracing::warn!(
                    "TLS handshake to {}:{} timed out (attempt {}/{})",
                    host,
                    port,
                    attempt + 1,
                    MAX_CONNECT_RETRIES
                );
                DnsCache::global().invalidate(host, port);
                last_err = Some(anyhow!("TLS handshake timed out"));
            }
        }

        if attempt + 1 < MAX_CONNECT_RETRIES {
            let backoff_ms = (50 * (1 << attempt)).min(500);
            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        }
    }

    Err(last_err.unwrap_or_else(|| anyhow!("Connection to {}:{} failed after {} attempts", host, port, MAX_CONNECT_RETRIES)))
}

/// A stream wrapper that yields bytes from an in-memory prefix buffer first,
/// then delegates all remaining read/write calls to the underlying socket.
pub struct PrefixedStream<S> {
    prefix: Vec<u8>,
    pos: usize,
    inner: S,
}

impl<S> PrefixedStream<S> {
    pub fn new(prefix: Vec<u8>, inner: S) -> Self {
        Self {
            prefix,
            pos: 0,
            inner,
        }
    }

    #[allow(dead_code)]
    pub fn into_inner(self) -> S {
        self.inner
    }
}

impl<S: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for PrefixedStream<S> {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        if self.pos < self.prefix.len() {
            let available = &self.prefix[self.pos..];
            let to_copy = available.len().min(buf.remaining());
            buf.put_slice(&available[..to_copy]);
            self.pos += to_copy;
            return std::task::Poll::Ready(Ok(()));
        }
        std::pin::Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: tokio::io::AsyncWrite + Unpin> tokio::io::AsyncWrite for PrefixedStream<S> {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::pin::Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dns_cache_insert_and_get() {
        let cache = DnsCache::new();
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        assert!(cache.get("localhost", 8080).is_none());

        cache.insert("localhost", 8080, vec![addr]);
        let cached = cache.get("localhost", 8080);
        assert!(cached.is_some());
        assert_eq!(cached.unwrap(), vec![addr]);

        cache.invalidate("localhost", 8080);
        assert!(cache.get("localhost", 8080).is_none());
    }

    #[tokio::test]
    async fn test_resolve_host_ip_literal() {
        let (addrs, from_cache) = resolve_host("127.0.0.1", 8080, true).await.unwrap();
        assert!(!from_cache);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0], "127.0.0.1:8080".parse::<SocketAddr>().unwrap());
    }

    #[tokio::test]
    async fn test_prefixed_stream_read_and_write() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let prefix = b"hello ".to_vec();
        let inner = std::io::Cursor::new(b"world".to_vec());
        let mut stream = PrefixedStream::new(prefix, inner);

        let mut output = Vec::new();
        stream.read_to_end(&mut output).await.unwrap();
        assert_eq!(output, b"hello world");

        let empty_prefix = Vec::new();
        let inner2 = std::io::Cursor::new(b"direct stream".to_vec());
        let mut stream2 = PrefixedStream::new(empty_prefix, inner2);
        let mut output2 = Vec::new();
        stream2.read_to_end(&mut output2).await.unwrap();
        assert_eq!(output2, b"direct stream");

        // Test writing through PrefixedStream
        let mut write_buf = std::io::Cursor::new(Vec::new());
        let mut stream3 = PrefixedStream::new(Vec::new(), &mut write_buf);
        stream3.write_all(b"write test").await.unwrap();
        assert_eq!(write_buf.into_inner(), b"write test");
    }
}


