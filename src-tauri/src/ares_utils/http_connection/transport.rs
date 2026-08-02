//! The raw plain/TLS socket abstraction (`Connection`) and the connect
//! logic that produces one.

use super::tls::get_tls_config;
use super::ConnectionOptions;
use anyhow::{anyhow, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::TlsConnector;

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
/// is set. Timeouts and cert-verification behavior come from `options`.
pub(super) async fn connect_stream(
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
