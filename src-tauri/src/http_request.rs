use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub fn http_request(http_request: String) -> Result<String, Box<dyn std::error::Error>> {
    let host = "google.com";
    let port = 80;
    let addr = format!("{}:{}", host, port);

    // Establish a TCP connection
    let mut stream = TcpStream::connect(&addr)?;
    println!("Connected to {}", addr);

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
            println!("Response received:\n{}", response);
            Ok(response)
        }
        Err(e) => {
            eprintln!("Read timeout or error: {}", e);
            Err(Box::new(e))
        }
    }
}
