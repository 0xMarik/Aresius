use std::io::{Read, Write};
use std::net::TcpStream;

pub fn http_request(content: String) -> Result<String, Box<dyn std::error::Error>> {
    // Change this to your target host and port
    let host = "google.com";
    let port = 80;
    let addr = format!("{}:{}", host, port);
    let path = "/";

    // Establish a TCP connection
    let mut stream = TcpStream::connect(&addr)?;
    println!("Connected to {}", addr);

    // Manually build an HTTP GET request with headers
    let http_request = format!(
        "GET {path} HTTP/1.1\r\n\
         Host: {}\r\n\
         User-Agent: Rust-TCP-Client/1.0\r\n\
         Accept: */*\r\n\
         Connection: close\r\n\
         \r\n",
        host
    );

    // Send the request
    stream.write_all(http_request.as_bytes())?;
    println!("HTTP request sent.");

    // Read and print the response
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer)?;
    let response = String::from_utf8_lossy(&buffer).to_string();

    println!("Response received:\n{}", response);

    Ok(response)
}
