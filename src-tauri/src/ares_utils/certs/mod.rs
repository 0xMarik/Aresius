use anyhow::{anyhow, Result};
use base64::Engine;
use rcgen::{
    CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, Issuer, KeyPair,
    KeyUsagePurpose,
};
use rustls::{pki_types::CertificateDer, ServerConfig};
use rustls_pemfile;
use std::fs;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio_rustls::TlsAcceptor;

pub mod certification_installation;
pub mod check_cert_installed;
#[cfg(target_os = "windows")]
pub mod win_crypto;

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

        let certs_dir = app_dir.join("certs");
        fs::create_dir_all(&certs_dir)?;

        Ok(Self {
            cert_path: certs_dir.join("aresius-ca-cert.pem"),
            key_path: certs_dir.join("aresius-ca-key.pem"),
        })
    }

    pub fn exists(&self) -> bool {
        self.cert_path.exists() && self.key_path.exists()
    }
}

pub fn ensure_ca_cert_exists(app_handle: &AppHandle) -> anyhow::Result<CaCertPaths> {
    let ca_paths = CaCertPaths::new(app_handle)?;
    if !ca_paths.exists() {
        generate_ca_cert(app_handle)?;
    }
    Ok(ca_paths)
}

pub fn read_cert_der_from_file(cert_path: &std::path::Path) -> Result<Vec<u8>, String> {
    if !cert_path.exists() {
        return Err("Certificate file does not exist".into());
    }
    let file = fs::File::open(cert_path).map_err(|e| format!("Failed to open cert file: {e}"))?;
    let mut reader = BufReader::new(file);
    let certs = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse PEM certificate: {e}"))?;
    let der = certs
        .into_iter()
        .next()
        .ok_or_else(|| "No certificate found in PEM file".to_string())?;
    Ok(der.to_vec())
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
        let key_pem = fs::read_to_string(&ca_paths.key_path)?;
        // Parse the key pair
        let key_pair = KeyPair::from_pem(&key_pem)?;

        // Read the existing certificate (Should be PEM format)
        let cert_pem = fs::read_to_string(&ca_paths.cert_path)?;

        // Validate the existing certificate by creating an Issuer
        Issuer::from_ca_cert_pem(&cert_pem, &key_pair)
            .map_err(|e| anyhow!("Failed to parse existing CA certificate: {}", e))?;

        // Check if certificate has expired or is not yet valid
        let der = read_cert_der_from_file(&ca_paths.cert_path).map_err(|e| anyhow!("{e}"))?;
        match x509_parser::parse_x509_certificate(&der) {
            Ok((_, parsed_cert)) => {
                let validity = parsed_cert.validity();
                let not_before = validity.not_before.timestamp();
                let not_after = validity.not_after.timestamp();
                let now_unix = chrono::Utc::now().timestamp();

                if now_unix < not_before || now_unix > not_after {
                    tracing::warn!(
                        "Existing CA certificate is outside its validity window (expired or not yet valid). Regenerating fresh CA certificate..."
                    );
                } else {
                    return Ok((cert_pem, key_pair));
                }
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to parse X.509 validity for existing CA certificate ({e}). Regenerating fresh CA certificate..."
                );
            }
        }
    }

    // Generate new CA certificate if it doesn't exist or is invalid/expired
    tracing::info!("Generating new CA certificate...");

    let mut params = CertificateParams::default();

    // Set up Distinguished Name with all fields - Country code MUST be 2 characters (ISO 3166-1)
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CountryName, "US");
    params
        .distinguished_name
        .push(DnType::StateOrProvinceName, "California");
    params
        .distinguished_name
        .push(DnType::LocalityName, "San Francisco");
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Aresius");
    params
        .distinguished_name
        .push(DnType::OrganizationalUnitName, "Aresius Security");
    params
        .distinguished_name
        .push(DnType::CommonName, "Aresius CA");

    // Mark as CA certificate
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];

    use chrono::Datelike;
    let now = chrono::Utc::now();
    let day = now.day().min(28) as u8;
    let month = now.month() as u8;
    let year = now.year();

    params.not_before = rcgen::date_time_ymd(year - 1, month, day);
    params.not_after = rcgen::date_time_ymd(year + 10, month, day);

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

    Ok((ca_cert_pem, key_pair))
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
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];

    use chrono::Datelike;
    let now = chrono::Utc::now();
    let day = now.day().min(28) as u8;
    let month = now.month() as u8;
    let year = now.year();

    params.not_before = rcgen::date_time_ymd(year - 1, month, day);
    params.not_after = rcgen::date_time_ymd(year + 1, month, day);

    let key_pair = KeyPair::generate()?;
    // Create issuer reference
    let issuer = Issuer::from_ca_cert_pem(ca_cert_pem, ca_key_pair)?;
    let cert = params.signed_by(&key_pair, &issuer)?;

    let leaf_cert_pem = cert.pem();
    let full_chain_pem = format!("{}\n{}", leaf_cert_pem.trim(), ca_cert_pem.trim());
    let key_pem = key_pair.serialize_pem();

    Ok((full_chain_pem.into_bytes(), key_pem.into_bytes()))
}


pub fn regenerate_ca_cert_files(app_handle: &AppHandle) -> anyhow::Result<(String, KeyPair)> {
    let ca_paths = CaCertPaths::new(app_handle)?;
    if ca_paths.cert_path.exists() {
        let _ = fs::remove_file(&ca_paths.cert_path);
    }
    if ca_paths.key_path.exists() {
        let _ = fs::remove_file(&ca_paths.key_path);
    }
    generate_ca_cert(app_handle)
}

#[tauri::command]
pub async fn regenerate_ca_cert(
    app: tauri::AppHandle,
    cert_cache: tauri::State<'_, crate::proxy::CertCache>,
) -> Result<(), String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;

    // Automatically remove the old CA certificate from the OS trust store first
    if paths.cert_path.exists() {
        if let Err(e) = crate::ares_utils::certs::certification_installation::remove_cert_from_os_store(&paths.cert_path).await {
            tracing::warn!("Failed to remove old certificate from OS trust store: {}", e);
        }
    }

    let (cert_pem, key_pair) = regenerate_ca_cert_files(&app).map_err(|e| e.to_string())?;
    cert_cache.set_ca(cert_pem, key_pair).await;
    tracing::info!("Old CA certificate removed from OS store, fresh certificate generated, and proxy cache cleared.");
    Ok(())
}


#[tauri::command]
pub async fn get_ca_cert_path(app: tauri::AppHandle) -> Result<String, String> {
    let paths = ensure_ca_cert_exists(&app).map_err(|e| e.to_string())?;
    Ok(paths.cert_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_ca_cert_pem(app: tauri::AppHandle) -> Result<String, String> {
    let paths = ensure_ca_cert_exists(&app).map_err(|e| e.to_string())?;
    fs::read_to_string(&paths.cert_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_cert_manager(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    #[cfg(target_os = "windows")]
    {
        app.opener()
            .open_path("certmgr.msc", None::<&str>)
            .map_err(|e| format!("failed to open certmgr.msc: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        app.opener()
            .open_path("/System/Applications/Utilities/Keychain Access.app", None::<&str>)
            .map_err(|e| format!("failed to open Keychain Access: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        app.opener()
            .open_path("/usr/local/share/ca-certificates", None::<&str>)
            .map_err(|e| format!("failed to open certificate directory: {e}"))?;
    }

    Ok(())
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomCertInfo {
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub serial: String,
    pub is_ca: bool,
    pub key_algorithm: String,
}

pub async fn validate_and_apply_ca_cert(
    app: &AppHandle,
    cert_cache: &crate::proxy::CertCache,
    cert_pem: &str,
    key_pem: &str,
) -> Result<CustomCertInfo, String> {
    let mut cert_reader = BufReader::new(cert_pem.as_bytes());
    let certs: Vec<CertificateDer> = rustls_pemfile::certs(&mut cert_reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse Certificate PEM: {e}"))?;

    if certs.is_empty() {
        return Err("No valid X.509 certificate found in PEM data.".into());
    }

    let cert_der = certs[0].as_ref();
    let (_, parsed_cert) = x509_parser::parse_x509_certificate(cert_der)
        .map_err(|e| format!("Failed to parse X.509 Certificate: {e}"))?;

    // 1. Check BasicConstraints: is_ca must be true
    let basic_constraints = parsed_cert
        .basic_constraints()
        .map_err(|e| format!("Error reading Basic Constraints extension: {e}"))?;

    match basic_constraints {
        Some(bc) => {
            if !bc.value.ca {
                return Err("Certificate is not configured as a Certificate Authority (BasicConstraints CA must be true to sign HTTPS traffic).".into());
            }
        }
        None => {
            return Err("Certificate lacks BasicConstraints extension (must be a CA certificate).".into());
        }
    }

    // 2. Check KeyUsage if present
    if let Ok(Some(ku)) = parsed_cert.key_usage() {
        if !ku.value.key_cert_sign() {
            return Err("Certificate KeyUsage does not permit certificate signing (keyCertSign bit is missing).".into());
        }
    }

    // 3. Check Validity Period
    let now = chrono::Utc::now().timestamp();
    let not_before = parsed_cert.validity().not_before.timestamp();
    let not_after = parsed_cert.validity().not_after.timestamp();

    if now < not_before {
        return Err(format!(
            "Certificate is not yet valid (valid from {}).",
            parsed_cert.validity().not_before
        ));
    }
    if now > not_after {
        return Err(format!(
            "Certificate has expired on {}.",
            parsed_cert.validity().not_after
        ));
    }

    // 4. Parse Private Key
    let key_pair = KeyPair::from_pem(key_pem)
        .map_err(|e| format!("Failed to parse private key PEM: {e}"))?;

    // 5. Verify Key matches Certificate by creating an Issuer and signing a test server certificate
    let issuer = Issuer::from_ca_cert_pem(cert_pem, &key_pair)
        .map_err(|e| format!("Private key does not match certificate or failed to construct CA issuer: {e}"))?;

    let test_params = CertificateParams::new(vec!["test.aresius.local".to_string()])
        .map_err(|e| format!("Failed to initialize test certificate params: {e}"))?;
    let test_key = KeyPair::generate()
        .map_err(|e| format!("Failed to generate test key: {e}"))?;
    let _test_signed = test_params
        .signed_by(&test_key, &issuer)
        .map_err(|e| format!("CA certificate and private key cannot sign child certificates: {e}"))?;

    // 6. Verification passed! Discard old certificate and apply new certificate
    let paths = CaCertPaths::new(app).map_err(|e| e.to_string())?;

    // Remove old CA certificate from OS trust store if previously installed
    if paths.cert_path.exists() {
        if let Err(e) = crate::ares_utils::certs::certification_installation::remove_cert_from_os_store(&paths.cert_path).await {
            tracing::warn!("Failed to remove old certificate from OS trust store: {}", e);
        }
    }

    // Write new CA cert and key files
    fs::write(&paths.cert_path, cert_pem.trim())
        .map_err(|e| format!("Failed to write CA certificate file: {e}"))?;
    fs::write(&paths.key_path, key_pem.trim())
        .map_err(|e| format!("Failed to write CA key file: {e}"))?;

    // Invalidate and update proxy TLS acceptor cache
    cert_cache.set_ca(cert_pem.to_string(), key_pair).await;
    tracing::info!("Custom CA certificate successfully installed and proxy cache updated.");

    let subject = parsed_cert.subject().to_string();
    let issuer_str = parsed_cert.issuer().to_string();
    let not_before_str = parsed_cert.validity().not_before.to_string();
    let not_after_str = parsed_cert.validity().not_after.to_string();
    let serial = parsed_cert.raw_serial_as_string();
    let key_algo = parsed_cert.signature_algorithm.algorithm.to_string();

    Ok(CustomCertInfo {
        subject,
        issuer: issuer_str,
        not_before: not_before_str,
        not_after: not_after_str,
        serial,
        is_ca: true,
        key_algorithm: key_algo,
    })
}

#[tauri::command]
pub async fn import_custom_cert_pem(
    app: tauri::AppHandle,
    cert_cache: tauri::State<'_, crate::proxy::CertCache>,
    cert_pem: String,
    key_pem: String,
) -> Result<CustomCertInfo, String> {
    let cert_pem = cert_pem.trim();
    let key_pem = key_pem.trim();

    if cert_pem.is_empty() {
        return Err("Certificate PEM content is empty.".into());
    }
    if key_pem.is_empty() {
        return Err("Private Key PEM content is empty.".into());
    }

    validate_and_apply_ca_cert(&app, &cert_cache, cert_pem, key_pem).await
}

#[tauri::command]
pub async fn import_custom_cert_p12(
    app: tauri::AppHandle,
    cert_cache: tauri::State<'_, crate::proxy::CertCache>,
    p12_base64: String,
    password: String,
) -> Result<CustomCertInfo, String> {
    let p12_bytes = base64::engine::general_purpose::STANDARD
        .decode(p12_base64.trim())
        .map_err(|e| format!("Invalid Base64 encoding for PKCS#12 archive: {e}"))?;

    let pfx = p12::PFX::parse(&p12_bytes)
        .map_err(|e| format!("Failed to parse PKCS#12 / PFX structure: {e:?}"))?;

    let cert_bags = pfx
        .cert_x509_bags(&password)
        .map_err(|e| format!("Failed to decrypt PKCS#12 certificate (incorrect password?): {e:?}"))?;

    if cert_bags.is_empty() {
        return Err("No X.509 certificates found inside the PKCS#12 archive.".into());
    }

    let key_bags = pfx
        .key_bags(&password)
        .map_err(|e| format!("Failed to decrypt PKCS#12 private key (incorrect password?): {e:?}"))?;

    if key_bags.is_empty() {
        return Err("No private key found inside the PKCS#12 archive.".into());
    }

    let cert_der = &cert_bags[0];
    let cert_b64 = base64::engine::general_purpose::STANDARD.encode(cert_der);
    let cert_pem = format!("-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n", cert_b64);

    let key_der = &key_bags[0];
    let key_b64 = base64::engine::general_purpose::STANDARD.encode(key_der);
    let key_pem = format!("-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----\n", key_b64);

    validate_and_apply_ca_cert(&app, &cert_cache, &cert_pem, &key_pem).await
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
    let mut config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

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
