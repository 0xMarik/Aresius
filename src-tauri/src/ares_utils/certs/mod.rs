use anyhow::{anyhow, Result};
use rcgen::{Certificate, CertificateParams, DistinguishedName, DnType, Issuer, KeyPair};
use rustls::{pki_types::CertificateDer, ServerConfig};
use rustls_pemfile;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio_rustls::TlsAcceptor;

pub struct CaCertPaths {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

impl CaCertPaths {
    pub fn new(app_handle: &AppHandle) -> std::io::Result<Self> {
        // Use Tauri's app data dir so it's per-user, persistent, and OS-appropriate
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        fs::create_dir_all(&app_dir)?;

        Ok(Self {
            cert_path: app_dir.join("aresius-ca-cert.pem"),
            key_path: app_dir.join("aresius-ca-key.pem"),
        })
    }

    pub fn exists(&self) -> bool {
        self.cert_path.exists() && self.key_path.exists()
    }
}

pub fn generate_ca_cert(app_handle: &AppHandle) -> anyhow::Result<(String, KeyPair)> {
    let ca_paths = CaCertPaths::new(&app_handle)?;

    // Check if CA certificate already exists
    if ca_paths.exists() {
        tracing::info!(
            "Loading existing CA certificate from {}",
            ca_paths.cert_path.display()
        );

        // Read the existing key
        let key_pem = fs::read_to_string(ca_paths.key_path)?;
        // Parse the key pair
        let key_pair = KeyPair::from_pem(&key_pem)?;

        // Read the existing certificate (Should be PEM format)
        let cert_pem = fs::read_to_string(&ca_paths.cert_path)?;

        // Validate the existing certificate by creating an Issuer
        Issuer::from_ca_cert_pem(&cert_pem, &key_pair)
            .map_err(|e| anyhow!("Failed to parse existing CA certificate: {}", e))?;

        return Ok((cert_pem, key_pair));
    }

    // Generate new CA certificate if it doesn't exist
    tracing::info!("Generating new CA certificate...");

    let mut params = CertificateParams::default();

    // Set up Distinguished Name with all fields
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CountryName, "Aresius");
    params
        .distinguished_name
        .push(DnType::StateOrProvinceName, "Aresius");
    params
        .distinguished_name
        .push(DnType::LocalityName, "Aresius");
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Aresius");
    params
        .distinguished_name
        .push(DnType::OrganizationalUnitName, "Aresius CA");
    params
        .distinguished_name
        .push(DnType::CommonName, "Aresius CA");

    // Mark as CA certificate
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);

    // Generate key pair
    let key_pair = KeyPair::generate()?;

    // Create self-signed certificate (Issuer = Subject)
    let cert = params.self_signed(&key_pair)?;

    // Save CA cert and key for future use
    let ca_cert_pem = cert.pem();
    let ca_key_pem = key_pair.serialize_pem();

    fs::write(&ca_paths.cert_path, &ca_cert_pem)?;
    fs::write(&ca_paths.key_path, &ca_key_pem)?;

    tracing::info!("CA certificate generated: {}", ca_paths.cert_path.display());
    tracing::info!("CA private key saved: {}", ca_paths.key_path.display());
    tracing::info!("Install this in Chrome: Settings > Privacy > Security > Manage certificates");

    Ok((cert.pem(), key_pair))
}

// Generate server certificate signed by CA
pub fn generate_server_cert(
    ca_cert_pem: &str,
    ca_key_pair: &KeyPair,
    domain: &str,
) -> Result<(Vec<u8>, Vec<u8>)> {
    let mut params = CertificateParams::new(vec![domain.to_string()])?;

    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, domain);
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Aresius");
    params.is_ca = rcgen::IsCa::NoCa;

    let key_pair = KeyPair::generate()?;
    // Create issuer reference
    let issuer = Issuer::from_ca_cert_pem(&ca_cert_pem, &ca_key_pair)?;
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
