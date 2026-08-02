pub mod body_decoder;
pub mod certs;
use url::Url;
pub mod http_connection;

#[derive(Debug, Clone)]
pub struct UrlComponents {
    // pub protocol: String,
    pub domain: String,
    pub port: u16,
}

pub fn url_parsing(url_str: &str) -> Option<UrlComponents> {
    let parsed_url = Url::parse(url_str).ok()?;

    // Get all required components
    // let protocol = parsed_url.scheme();
    let domain = parsed_url.domain()?;
    let port = parsed_url.port_or_known_default()?; // This will fail if no port and no known default

    // If we got here, all components are present
    let components = UrlComponents {
        // protocol: protocol.to_string(),
        domain: domain.to_string(),
        port,
    };
    Some(components)
}
