use anyhow::{anyhow, Result};
use rcgen::{Certificate, CertificateParams, DistinguishedName, DnType, Issuer, KeyPair};
use rustls::{pki_types::CertificateDer, ServerConfig};
use rustls_pemfile;
use std::fs;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;
use tokio_rustls::TlsAcceptor;

pub fn generate_ca_cert() -> Result<(Certificate, KeyPair)> {
    let ca_cert_path = "ca_cert.pem";
    let ca_key_path = "ca_key.pem";

    // Check if CA certificate already exists
    if Path::new(ca_cert_path).exists() && Path::new(ca_key_path).exists() {
        println!("Loading existing CA certificate from {}", ca_cert_path);

        // Read the existing key
        let key_pem = fs::read_to_string(ca_key_path)?;

        // Parse the key pair
        let key_pair = KeyPair::from_pem(&key_pem)?;

        // Regenerate certificate params
        let mut params = CertificateParams::default();
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
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);

        // Recreate the certificate with the existing key
        let cert = params.self_signed(&key_pair)?;

        return Ok((cert, key_pair));
    }

    // Generate new CA certificate if it doesn't exist
    println!("Generating new CA certificate...");

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

    // Save CA cert and key for future use
    let ca_cert_pem = cert.pem();
    let ca_key_pem = key_pair.serialize_pem();

    fs::write(ca_cert_path, &ca_cert_pem)?;
    fs::write(ca_key_path, &ca_key_pem)?;

    println!("CA certificate generated: {}", ca_cert_path);
    println!("CA private key saved: {}", ca_key_path);
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

// pub async fn handle_http_request(
//     mut client_stream: TcpStream,
//     request: &str,
//     initial_data: &[u8],
// ) -> std::io::Result<()> {
//     println!("=== HTTP REQUEST ===");
//     println!("{}", request);

//     let target = parse_target(request)?;
//     let mut server_stream = TcpStream::connect(&target).await?;
//     server_stream.write_all(initial_data).await?;

//     tokio::io::copy_bidirectional(&mut client_stream, &mut server_stream).await?;
//     Ok(())
// }

// pub fn parse_target(request: &str) -> std::io::Result<String> {
//     for line in request.lines() {
//         if line.to_lowercase().starts_with("host:") {
//             let host = line[5..].trim();
//             if host.contains(':') {
//                 return Ok(host.to_string());
//             } else {
//                 return Ok(format!("{}:80", host));
//             }
//         }
//     }
//     Err(std::io::Error::new(
//         std::io::ErrorKind::InvalidInput,
//         "No Host header found",
//     ))
// }
