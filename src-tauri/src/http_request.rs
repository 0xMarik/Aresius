use crate::ares_utils;
use anyhow::{anyhow, Result};
use ares_utils::url_parsing;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

pub struct HttpConnection {
    stream: TcpStream,
    host: String,
    port: u16,
    disconnected: bool,
}

impl HttpConnection {
    pub async fn new(url: &str) -> Result<Self> {
        let url_component =
            url_parsing(&url).ok_or_else(|| anyhow::anyhow!("URL parsing failed"))?;
        let host = url_component.domain;
        let port = url_component.port;
        let addr = format!("{}:{}", host, port);

        let stream = TcpStream::connect(&addr).await.unwrap();
        let disconnected = false;

        Ok(Self {
            stream,
            host,
            port,
            disconnected,
        })
    }

    async fn reconnect(&mut self) -> Result<()> {
        let addr = format!("{}:{}", self.host, self.port);
        self.stream = TcpStream::connect(&addr).await?;
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
        self.stream.write_all(http_request.as_bytes()).await?;

        // Read the response in chunks
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 4096];
        let mut content_length: Option<usize> = None;
        let mut headers_complete = false;
        let mut header_end_pos = 0;

        loop {
            match timeout(Duration::from_secs(30), self.stream.read(&mut chunk)).await {
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
}

// pub fn http_request(
//     http_request: &str,
//     url: &str,
// ) -> Result<(String, Duration), Box<dyn std::error::Error>> {
//     let url_component = url_parsing(&url).ok_or("URL parsing failed")?;
//     let host = &url_component.domain;
//     let port = url_component.port;
//     let addr = format!("{}:{}", host, port);

//     // Start timing
//     let start = Instant::now();

//     // Establish TCP connection
//     let mut stream =
//         TcpStream::connect(&addr).map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

//     // Set read timeout
//     stream.set_read_timeout(Some(Duration::from_secs(10)))?;

//     // Send the request
//     stream
//         .write_all(http_request.as_bytes())
//         .map_err(|e| format!("Failed to send request: {}", e))?;

//     println!("HTTP request sent to {}", addr);

// }
