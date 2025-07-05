use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use url::Url;

fn url_parsing(url_str: &str) -> Option<String> {
    match Url::parse(url_str) {
        Ok(parsed_url) => {
            if let Some(domain) = parsed_url.domain() {
                println!("Domain: {}", domain);
                Some(domain.to_string())
            } else {
                println!("No domain found");
                None
            }
        }
        Err(e) => {
            eprintln!("Failed to parse URL: {}", e);
            None
        }
    }
}

pub fn http_request(
    http_request: String,
    url: String,
) -> Result<String, Box<dyn std::error::Error>> {
    let _domain = url_parsing(&url).unwrap_or_else(|| {
        eprintln!("Fatal: URL parsing failed");
        std::process::exit(1);
    });
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
