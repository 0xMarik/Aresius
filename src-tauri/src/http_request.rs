use crate::ares_utils::*;
use anyhow::{anyhow, Result};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;

enum Connection {
    Plain(TcpStream),
    Tls(tokio_rustls::client::TlsStream<TcpStream>),
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
}

pub struct HttpConnection {
    connection: Connection,
    host: String,
    port: u16,
    disconnected: bool,
    use_tls: bool,
}

impl HttpConnection {
    pub async fn new(url: &str) -> Result<Self> {
        let url_component =
            url_parsing(&url).ok_or_else(|| anyhow::anyhow!("URL parsing failed"))?;

        let host = url_component.domain;
        let port = url_component.port;
        let use_tls = url.starts_with("https://");

        let addr = format!("{}:{}", host, port);
        let tcp_stream = TcpStream::connect(&addr).await?;

        let connection = if use_tls {
            // Create TLS connector with system root certificates
            let mut root_store = RootCertStore::empty();

            // Add system certificates
            for cert in
                rustls_native_certs::load_native_certs().expect("could not load platform certs")
            {
                root_store.add(cert).ok();
            }

            let config = ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();

            let connector = TlsConnector::from(Arc::new(config));
            let server_name = ServerName::try_from(host.clone())
                .map_err(|_| anyhow!("Invalid DNS name"))?
                .to_owned();

            let tls_stream = connector.connect(server_name, tcp_stream).await?;
            Connection::Tls(tls_stream)
        } else {
            Connection::Plain(tcp_stream)
        };

        let disconnected = false;

        Ok(Self {
            connection,
            host,
            port,
            disconnected,
            use_tls,
        })
    }

    async fn reconnect(&mut self) -> Result<()> {
        let addr = format!("{}:{}", self.host, self.port);
        let tcp_stream = TcpStream::connect(&addr).await?;

        self.connection = if self.use_tls {
            let mut root_store = RootCertStore::empty();

            for cert in
                rustls_native_certs::load_native_certs().expect("could not load platform certs")
            {
                root_store.add(cert).ok();
            }

            let config = ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();

            let connector = TlsConnector::from(Arc::new(config));
            let server_name =
                ServerName::try_from(self.host.clone()).map_err(|_| anyhow!("Invalid DNS name"))?;

            let tls_stream = connector.connect(server_name, tcp_stream).await?;
            Connection::Tls(tls_stream)
        } else {
            Connection::Plain(tcp_stream)
        };

        Ok(())
    }

    pub async fn send_request(&mut self, http_request: &str) -> Result<(String, Duration)> {
        // Check if we need to reconnect
        if self.disconnected {
            eprintln!("Connection was closed by server, reconnecting...");
            self.reconnect().await?;
            self.disconnected = false;
        }

        let start = Instant::now();

        // Send request
        self.connection.write_all(http_request.as_bytes()).await?;

        // Read the response in chunks
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 4096];
        let mut content_length: Option<usize> = None;
        let mut headers_complete = false;
        let mut header_end_pos = 0;

        loop {
            match timeout(Duration::from_secs(30), self.connection.read(&mut chunk)).await {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    buffer.extend_from_slice(&chunk[..n]);

                    if !headers_complete {
                        let buffer_str = String::from_utf8_lossy(&buffer);
                        if let Some(pos) = buffer_str.find("\r\n\r\n") {
                            headers_complete = true;
                            header_end_pos = pos + 4;

                            // Check for Connection: close header
                            for line in buffer_str[..pos].lines() {
                                let line_lower = line.to_lowercase();
                                if line_lower.starts_with("connection:") {
                                    if line_lower.contains("close") {
                                        self.disconnected = true;
                                    }
                                }
                                if line_lower.starts_with("content-length:") {
                                    if let Some(len_str) = line.split(':').nth(1) {
                                        content_length = len_str.trim().parse().ok();
                                    }
                                }
                            }
                        }
                    }

                    if headers_complete {
                        if let Some(expected_len) = content_length {
                            let body_len = buffer.len() - header_end_pos;
                            if body_len >= expected_len {
                                break;
                            }
                        } else {
                            let buffer_str = String::from_utf8_lossy(&buffer);
                            if buffer_str
                                .to_lowercase()
                                .contains("transfer-encoding: chunked")
                            {
                                if buffer_str.ends_with("0\r\n\r\n") {
                                    break;
                                }
                            }
                        }
                    }
                }
                Ok(Err(e)) => return Err(anyhow!("Failed to read response: {}", e)),
                Err(_) => {
                    if headers_complete && !buffer.is_empty() {
                        break;
                    }
                    return Err(anyhow!("Read timeout"));
                }
            }
        }

        let elapsed = start.elapsed();
        let response = String::from_utf8_lossy(&buffer).to_string();
        Ok((response, elapsed))
    }

    pub async fn close(&mut self) -> Result<()> {
        match &mut self.connection {
            Connection::Tls(stream) => {
                stream.shutdown().await?;
            }
            Connection::Plain(stream) => {
                stream.shutdown().await?;
            }
        }
        self.disconnected = true;
        Ok(())
    }
}
