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
pub(super) enum Connection {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

impl Connection {
    pub(super) async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        match self {
            Connection::Plain(stream) => stream.write_all(buf).await,
            Connection::Tls(stream) => stream.write_all(buf).await,
        }
    }

    pub(super) async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Connection::Plain(stream) => stream.read(buf).await,
            Connection::Tls(stream) => stream.read(buf).await,
        }
    }

    pub(super) async fn shutdown(&mut self) -> std::io::Result<()> {
        match self {
            Connection::Plain(stream) => stream.shutdown().await,
            Connection::Tls(stream) => stream.shutdown().await,
        }
    }
}

/// Opens a TCP connection to `host:port`, wrapping it in TLS when `use_tls`
/// is set. Timeouts, DNS caching, and cert-verification behavior come from `options`.
pub(super) async fn connect_stream(
    host: &str,
    port: u16,
    use_tls: bool,
    options: &ConnectionOptions,
) -> Result<Connection> {
    let (addrs, from_cache) = resolve_host(host, port, true).await?;
    let tcp_stream = match connect_tcp(&addrs, options.connect_timeout).await {
        Ok(stream) => stream,
        Err(_e) if from_cache => {
            // Invalidate stale DNS cache and retry fresh lookup once
            tracing::debug!("Cached DNS failed for {}:{}, re-resolving...", host, port);
            DnsCache::global().invalidate(host, port);
            let (fresh_addrs, _) = resolve_host(host, port, false).await?;
            connect_tcp(&fresh_addrs, options.connect_timeout).await?
        }
        Err(e) => return Err(e),
    };

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
}


