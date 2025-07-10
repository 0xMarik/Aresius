use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use crate::ares_utils;
use ares_utils::url_parsing;

pub fn http_request(http_request: &str, url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let url_component = url_parsing(&url).unwrap_or_else(|| {
        eprintln!("Fatal: URL parsing failed");
        std::process::exit(1);
    });

    println!("Modified HTTP Request: {}", http_request);

    let host = url_component.domain;
    let port = url_component.port;
    let addr = format!("{}:{}", host, port);

    // Establish a TCP connection
    let mut stream = TcpStream::connect(&addr)?;
    // println!("Connected to {}", addr);

    // Set read timeout (e.g., 5 seconds)
    stream.set_read_timeout(Some(Duration::new(10, 0)))?;

    // Send the request
    stream.write_all(http_request.as_bytes())?;
    println!("HTTP request sent.");

    // Read and print the response
    let mut buffer = Vec::new();
    match stream.read_to_end(&mut buffer) {
        Ok(_) => {
            let response = String::from_utf8_lossy(&buffer).to_string();
            println!("\nResponse received:\n{}", response);
            Ok(response)
        }
        Err(e) => {
            eprintln!("Read timeout or error: {}", e);
            Err(Box::new(e))
        }
    }
}
