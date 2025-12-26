use crate::ares_utils;
use ares_utils::url_parsing;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub fn http_request(http_request: &str, url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let url_component = url_parsing(&url).ok_or("URL parsing failed")?;
    let host = &url_component.domain;
    let port = url_component.port;
    let addr = format!("{}:{}", host, port);

    // Establish TCP connection
    let mut stream =
        TcpStream::connect(&addr).map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

    // Set read timeout
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;

    // Send the request
    stream
        .write_all(http_request.as_bytes())
        .map_err(|e| format!("Failed to send request: {}", e))?;

    println!("HTTP request sent to {}", addr);

    // Read the response in chunks
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut content_length: Option<usize> = None;
    let mut headers_complete = false;
    let mut header_end_pos = 0;

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break, // Connection closed
            Ok(n) => {
                buffer.extend_from_slice(&chunk[..n]);

                // Parse headers to get Content-Length
                if !headers_complete {
                    let buffer_str = String::from_utf8_lossy(&buffer);
                    if let Some(pos) = buffer_str.find("\r\n\r\n") {
                        headers_complete = true;
                        header_end_pos = pos + 4;

                        // Extract Content-Length from headers
                        for line in buffer_str[..pos].lines() {
                            if line.to_lowercase().starts_with("content-length:") {
                                if let Some(len_str) = line.split(':').nth(1) {
                                    content_length = len_str.trim().parse().ok();
                                }
                            }
                        }
                    }
                }

                // Check if we have complete response
                if headers_complete {
                    if let Some(expected_len) = content_length {
                        let body_len = buffer.len() - header_end_pos;
                        if body_len >= expected_len {
                            break; // We have the complete response
                        }
                    } else {
                        // No Content-Length, check for chunked encoding
                        let buffer_str = String::from_utf8_lossy(&buffer);
                        if buffer_str
                            .to_lowercase()
                            .contains("transfer-encoding: chunked")
                        {
                            // Check for end of chunked response (0\r\n\r\n)
                            if buffer_str.ends_with("0\r\n\r\n") {
                                break;
                            }
                        }
                    }
                }
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                // Timeout - assume response is complete
                if headers_complete && !buffer.is_empty() {
                    break;
                }
                return Err(format!("Read timeout: {}", e).into());
            }
            Err(e) => return Err(format!("Failed to read response: {}", e).into()),
        }
    }

    let response = String::from_utf8_lossy(&buffer).to_string();
    Ok(response)
}
