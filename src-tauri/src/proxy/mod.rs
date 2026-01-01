use crate::ares_utils::certs::*;
use rcgen::Certificate;
use std::sync::Arc;
use tokio::io::copy_bidirectional;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsConnector;

use rcgen::{CertificateParams, CertificateSigningRequest, DistinguishedName, DnType, KeyPair};
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, ServerName},
    ClientConfig, RootCertStore, ServerConfig,
};
use rustls_pemfile;
use std::fs;
use std::io::BufReader;
use tokio_rustls::TlsAcceptor;

// pub async fn start_http_proxy(bind_addr: &str) -> std::io::Result<()> {
//     let listener = TcpListener::bind(bind_addr).await?;
//     println!("HTTP Proxy listening on {}", bind_addr);

//     loop {
//         match listener.accept().await {
//             Ok((client_stream, addr)) => {
//                 println!("New connection from: {}", addr);
//                 tokio::spawn(async move {
//                     if let Err(e) = handle_client(client_stream).await {
//                         eprintln!("Error handling client: {}", e);
//                     }
//                 });
//             }
//             Err(e) => eprintln!("Connection failed: {}", e),
//         }
//     }
// }

pub async fn start_http_proxy(bind_addr: &str) -> std::io::Result<()> {
    // Generate CA certificate once at startup
    let (ca_cert, key_pair) =
        generate_ca_cert().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let ca_cert = Arc::new(ca_cert);
    let key_pair = Arc::new(key_pair);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    println!("MITM Proxy listening on {}", bind_addr);

    loop {
        match listener.accept().await {
            Ok((client_stream, addr)) => {
                println!("New connection from: {}", addr);
                let ca_cert = ca_cert.clone();
                let key_pair = key_pair.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(client_stream, ca_cert, key_pair).await {
                        println!("Error: {}", e);
                    }
                });
            }
            Err(e) => println!("Connection failed: {}", e),
        }
    }
}

// async fn handle_client(mut client_stream: TcpStream) -> std::io::Result<()> {
//     let mut buffer = [0u8; 8192];
//     let bytes_read = client_stream.read(&mut buffer).await?;

//     if bytes_read == 0 {
//         return Ok(());
//     }

//     let request = String::from_utf8_lossy(&buffer[..bytes_read]);

//     // Check if it's a CONNECT request (HTTPS)
//     if request.starts_with("CONNECT ") {
//         println!("=== HTTPS CONNECT REQUEST ===");
//         println!("{}", request.lines().next().unwrap_or(""));

//         // Parse target from "CONNECT example.com:443 HTTP/1.1"
//         let target = request
//             .lines()
//             .next()
//             .and_then(|line| line.split_whitespace().nth(1))
//             .ok_or_else(|| {
//                 std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid CONNECT request")
//             })?;

//         println!("Tunneling to: {}", target);

//         // Connect to target server
//         let mut server_stream = TcpStream::connect(target).await?;

//         // Send success response to client
//         client_stream
//             .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
//             .await?;

//         // Now just tunnel bytes bidirectionally (can't see encrypted content)
//         tokio::select! {
//             result = copy_bidirectional(&mut client_stream, &mut server_stream) => {
//                 match result {
//                     Ok((client_to_server, server_to_client)) => {
//                         println!("Tunnel closed. Sent: {} bytes, Received: {} bytes",
//                                    client_to_server, server_to_client);
//                     }
//                     Err(e) => println!("Tunnel error: {}", e),
//                 }
//             }
//         }

//         return Ok(());
//     }

//     // Log the request
//     println!("=== REQUEST ===");
//     println!("{}", request);
//     println!("===============");

//     let target = parse_target(&request)?;
//     println!("Connecting to: {}", target);

//     let mut server_stream = TcpStream::connect(&target).await?;
//     server_stream.write_all(&buffer[..bytes_read]).await?;

//     // Read and log response
//     let mut response_data = Vec::new();
//     loop {
//         let bytes = server_stream.read(&mut buffer).await?;
//         if bytes == 0 {
//             break;
//         }
//         response_data.extend_from_slice(&buffer[..bytes]);
//         client_stream.write_all(&buffer[..bytes]).await?;
//     }

//     // Log response headers (first part)
//     let response_str = String::from_utf8_lossy(&response_data);
//     if let Some(header_end) = response_str.find("\r\n\r\n") {
//         let headers = &response_str[..header_end];
//         println!("=== RESPONSE HEADERS ===");
//         println!("{}", headers);
//         println!(
//             "Response body size: {} bytes",
//             response_data.len() - header_end - 4
//         );
//         println!("========================");
//     } else {
//         println!("=== RESPONSE ===");
//         println!("Total bytes: {}", response_data.len());
//         println!("================");
//     }

//     Ok(())
// }

// Main client handler
async fn handle_client(
    mut client_stream: TcpStream,
    ca_cert: Arc<Certificate>,
    ca_key_pair: Arc<KeyPair>,
) -> std::io::Result<()> {
    let mut buffer = [0u8; 8192];
    let bytes_read = client_stream.read(&mut buffer).await?;

    if bytes_read == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);

    if request.starts_with("CONNECT ") {
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid CONNECT")
            })?;

        let domain = target.split(':').next().unwrap_or(target);
        println!("MITM CONNECT to: {}", target);

        // Send 200 OK to client
        client_stream
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;

        // Generate certificate for this domain
        let (cert_pem, key_pem) = generate_server_cert(&ca_key_pair, domain)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        let acceptor = create_tls_acceptor(&cert_pem, &key_pem)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        // Perform TLS handshake with client
        let mut client_tls = acceptor.accept(client_stream).await?;

        // Read decrypted request from client
        let mut buffer = vec![0u8; 8192];
        let bytes_read = client_tls.read(&mut buffer).await?;
        let decrypted_request = String::from_utf8_lossy(&buffer[..bytes_read]);

        println!("╔═══ DECRYPTED HTTPS REQUEST ═══");
        for line in decrypted_request.lines() {
            println!("║ {}", line);
        }
        println!("╚═══════════════════════════════");

        // Connect to real server with TLS
        let server_stream = TcpStream::connect(target).await?;

        // Create client config with native roots
        let mut root_store = RootCertStore::empty();
        for cert in rustls_native_certs::load_native_certs().expect("could not load platform certs")
        {
            root_store.add(cert).ok();
        }

        let client_config = ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        let connector = TlsConnector::from(Arc::new(client_config));

        let server_name = ServerName::try_from(domain.to_string())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;

        let mut server_tls = connector.connect(server_name, server_stream).await?;

        // Forward decrypted request to server
        server_tls.write_all(&buffer[..bytes_read]).await?;

        // Read response from server
        let mut response_buffer = vec![0u8; 8192];
        let response_bytes = server_tls.read(&mut response_buffer).await?;
        let decrypted_response = String::from_utf8_lossy(&response_buffer[..response_bytes]);

        println!("╔═══ DECRYPTED HTTPS RESPONSE ═══");
        if let Some(header_end) = decrypted_response.find("\r\n\r\n") {
            for line in decrypted_response[..header_end].lines() {
                println!("║ {}", line);
            }
        }
        println!("╚════════════════════════════════");

        // Send response back to client
        client_tls
            .write_all(&response_buffer[..response_bytes])
            .await?;

        // Continue tunneling remaining data
        tokio::io::copy_bidirectional(&mut client_tls, &mut server_tls).await?;

        return Ok(());
    }

    // Handle regular HTTP
    handle_http_request(client_stream, &request, &buffer[..bytes_read]).await
}

async fn handle_http_request(
    mut client_stream: TcpStream,
    request: &str,
    initial_data: &[u8],
) -> std::io::Result<()> {
    println!("=== HTTP REQUEST ===");
    println!("{}", request);

    let target = parse_target(request)?;
    let mut server_stream = TcpStream::connect(&target).await?;
    server_stream.write_all(initial_data).await?;

    tokio::io::copy_bidirectional(&mut client_stream, &mut server_stream).await?;
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
