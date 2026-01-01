use rcgen::{Certificate, CertificateParams, DistinguishedName, DnType, KeyPair};
use std::fs;
use std::sync::Arc;
use tokio_rustls::TlsAcceptor;
use url::Url;

fn generate_ca_cert() -> Result<(Certificate, String), Box<dyn std::error::Error>> {
    let mut params = CertificateParams::default();
    
    // Set up Distinguished Name with all fields
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CountryName, "AresProxy");
    params.distinguished_name.push(DnType::StateOrProvinceName, "AresProxy");
    params.distinguished_name.push(DnType::LocalityName, "AresProxy");
    params.distinguished_name.push(DnType::OrganizationName, "AresProxy");
    params.distinguished_name.push(DnType::OrganizationalUnitName, "AresProxy CA");
    params.distinguished_name.push(DnType::CommonName, "AresProxy CA");
    
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
    
    Ok((cert, ca_cert_pem))
}

fn create_tls_acceptor(
    cert_pem: &[u8],
    key_pem: &[u8],
) -> Result<TlsAcceptor, Box<dyn std::error::Error>> {
    let certs = rustls_pemfile::certs(&mut &*cert_pem)?
        .into_iter()
        .map(rustls::Certificate)
        .collect();

    let key = rustls_pemfile::pkcs8_private_keys(&mut &*key_pem)?
        .into_iter()
        .next()
        .ok_or("No private key found")?;

    let config = ServerConfig::builder()
        .with_safe_defaults()
        .with_no_client_auth()
        .with_single_cert(certs, rustls::PrivateKey(key))?;

    Ok(TlsAcceptor::from(Arc::new(config)))
}