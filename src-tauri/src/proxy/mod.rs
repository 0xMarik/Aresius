use tokio::io::copy_bidirectional;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub async fn start_http_proxy(bind_addr: &str) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind_addr).await?;
    println!("HTTP Proxy listening on {}", bind_addr);

    loop {
        match listener.accept().await {
            Ok((client_stream, addr)) => {
                println!("New connection from: {}", addr);
                tokio::spawn(async move {
                    if let Err(e) = handle_client(client_stream).await {
                        eprintln!("Error handling client: {}", e);
                    }
                });
            }
            Err(e) => eprintln!("Connection failed: {}", e),
        }
    }
}

async fn handle_client(mut client_stream: TcpStream) -> std::io::Result<()> {
    let mut buffer = [0u8; 8192];
    let bytes_read = client_stream.read(&mut buffer).await?;

    if bytes_read == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);

    // Check if it's a CONNECT request (HTTPS)
    if request.starts_with("CONNECT ") {
        println!("=== HTTPS CONNECT REQUEST ===");
        println!("{}", request.lines().next().unwrap_or(""));

        // Parse target from "CONNECT example.com:443 HTTP/1.1"
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid CONNECT request")
            })?;

        println!("Tunneling to: {}", target);

        // Connect to target server
        let mut server_stream = TcpStream::connect(target).await?;

        // Send success response to client
        client_stream
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;

        // Now just tunnel bytes bidirectionally (can't see encrypted content)
        tokio::select! {
            result = copy_bidirectional(&mut client_stream, &mut server_stream) => {
                match result {
                    Ok((client_to_server, server_to_client)) => {
                        println!("Tunnel closed. Sent: {} bytes, Received: {} bytes",
                                   client_to_server, server_to_client);
                    }
                    Err(e) => println!("Tunnel error: {}", e),
                }
            }
        }

        return Ok(());
    }

    // Log the request
    println!("=== REQUEST ===");
    println!("{}", request);
    println!("===============");

    let target = parse_target(&request)?;
    println!("Connecting to: {}", target);

    let mut server_stream = TcpStream::connect(&target).await?;
    server_stream.write_all(&buffer[..bytes_read]).await?;

    // Read and log response
    let mut response_data = Vec::new();
    loop {
        let bytes = server_stream.read(&mut buffer).await?;
        if bytes == 0 {
            break;
        }
        response_data.extend_from_slice(&buffer[..bytes]);
        client_stream.write_all(&buffer[..bytes]).await?;
    }

    // Log response headers (first part)
    let response_str = String::from_utf8_lossy(&response_data);
    if let Some(header_end) = response_str.find("\r\n\r\n") {
        let headers = &response_str[..header_end];
        println!("=== RESPONSE HEADERS ===");
        println!("{}", headers);
        println!(
            "Response body size: {} bytes",
            response_data.len() - header_end - 4
        );
        println!("========================");
    } else {
        println!("=== RESPONSE ===");
        println!("Total bytes: {}", response_data.len());
        println!("================");
    }

    Ok(())
}

fn parse_target(request: &str) -> std::io::Result<String> {
    // Extract host from HTTP request
    for line in request.lines() {
        if line.to_lowercase().starts_with("host:") {
            let host = line[5..].trim();
            // Default to port 80 if not specified
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
