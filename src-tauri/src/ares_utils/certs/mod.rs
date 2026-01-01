use anyhow::{anyhow, Result};
use rcgen::{Certificate, CertificateParams, DistinguishedName, DnType, Issuer, KeyPair};
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer},
    ServerConfig,
};
use rustls_pemfile;
use std::fs;
use std::io::BufReader;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio_rustls::TlsAcceptor;

pub fn generate_ca_cert() -> Result<(Certificate, KeyPair)> {
    let mut params = CertificateParams::default();

    // Set up Distinguished Name with all fields
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CountryName, "AresProxy");
    params
        .distinguished_name
        .push(DnType::StateOrProvinceName, "AresProxy");
    params
        .distinguished_name
        .push(DnType::LocalityName, "AresProxy");
    params
        .distinguished_name
        .push(DnType::OrganizationName, "AresProxy");
    params
        .distinguished_name
        .push(DnType::OrganizationalUnitName, "AresProxy CA");
    params
        .distinguished_name
        .push(DnType::CommonName, "AresProxy CA");

    // Mark as CA certificate
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);

    // Generate key pair
    let key_pair = KeyPair::generate()?;

    // Create self-signed certificate (Issuer = Subject)
    let cert = params.self_signed(&key_pair)?;

    // Save CA cert for installing in browser
    let ca_cert_pem = cert.pem();
    fs::write("ca_cert.pem", &ca_cert_pem)?;

    println!("CA certificate generated: ca_cert.pem");
    println!("Install this in Chrome: Settings > Privacy > Security > Manage certificates");

    Ok((cert, key_pair))
}

// Generate server certificate signed by CA
pub fn generate_server_cert(ca_key_pair: &KeyPair, domain: &str) -> Result<(Vec<u8>, Vec<u8>)> {
    let mut params = CertificateParams::new(vec![domain.to_string()])?;

    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, domain);
    params
        .distinguished_name
        .push(DnType::OrganizationName, "AresProxy");

    let key_pair = KeyPair::generate()?;

    // Create issuer reference
    let issuer = Issuer::new(params.clone(), &ca_key_pair);
    let cert = params.signed_by(&key_pair, &issuer)?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    Ok((cert_pem.into_bytes(), key_pem.into_bytes()))
}

pub fn create_tls_acceptor(cert_pem: &[u8], key_pem: &[u8]) -> Result<TlsAcceptor> {
    // Parse certificates
    let mut cert_reader = BufReader::new(cert_pem);
    let certs: Vec<CertificateDer> =
        rustls_pemfile::certs(&mut cert_reader).collect::<Result<Vec<_>, _>>()?;

    // Parse private key
    let mut key_reader = BufReader::new(key_pem);
    let key = rustls_pemfile::private_key(&mut key_reader)?
        .ok_or_else(|| anyhow!("No private key found"))?;

    // Build server config
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;

    Ok(TlsAcceptor::from(Arc::new(config)))
}

pub async fn handle_http_request(
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

pub fn parse_target(request: &str) -> std::io::Result<String> {
    for line in request.lines() {
        if line.to_lowercase().starts_with("host:") {
            let host = line[5..].trim();
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
