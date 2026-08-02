//! TLS client configuration: platform root-of-trust loading, the opt-in
//! "accept any certificate" verifier for reaching pentest targets with
//! broken TLS, and a process-wide cache so the (blocking) root-store load
//! only happens once per verification mode.

use anyhow::{anyhow, Result};
use std::sync::{Arc, OnceLock};
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};

/// Verifier that accepts any certificate presented by the server.
///
/// This exists because Aresius is a pentest/interception proxy that has to
/// be able to reach targets with self-signed, expired, or hostname-mismatched
/// certificates. It must only be used when the caller has explicitly opted
/// into `verify_certs: false` (e.g. a "trust this target anyway" toggle in
/// the UI) -- never as a silent default.
#[derive(Debug)]
struct NoCertVerification;

impl ServerCertVerifier for NoCertVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, tokio_rustls::rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA1,
            SignatureScheme::ECDSA_SHA1_Legacy,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

/// Loads the OS's trusted root certificates into a rustls `RootCertStore`.
/// Split out from `build_tls_config` because this is the part with its own
/// failure modes -- individual certs can fail to parse, or the whole store
/// can come back empty -- independent of which verifier we end up building
/// around it.
fn load_platform_root_store() -> Result<RootCertStore> {
    let mut root_store = RootCertStore::empty();
    let native_certs = rustls_native_certs::load_native_certs();

    if !native_certs.errors.is_empty() {
        eprintln!(
            "warning: {} error(s) while loading platform root certificates",
            native_certs.errors.len()
        );
    }

    let mut failed = 0usize;
    for cert in native_certs.certs {
        if root_store.add(cert).is_err() {
            failed += 1;
        }
    }
    if failed > 0 {
        eprintln!(
            "warning: {} platform root certificate(s) could not be added to the trust store",
            failed
        );
    }
    if root_store.is_empty() {
        return Err(anyhow!(
            "no usable platform root certificates were found; TLS connections will fail"
        ));
    }

    Ok(root_store)
}

/// Builds (once per process, per verification mode) the rustls `ClientConfig`
/// used for outbound TLS connections. Loading the platform root store is a
/// blocking syscall and was previously repeated on every single connection
/// and reconnection -- this caches it instead.
fn build_tls_config(verify_certs: bool) -> Result<Arc<ClientConfig>> {
    let mut config = if verify_certs {
        ClientConfig::builder()
            .with_root_certificates(load_platform_root_store()?)
            .with_no_client_auth()
    } else {
        ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertVerification))
            .with_no_client_auth()
    };

    // Force HTTP/1.1 so this hand-rolled parser never has to deal with a
    // server that decided to negotiate something else via ALPN.
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

    Ok(Arc::new(config))
}

/// Returns the cached TLS config for the given verification mode, building
/// it on first use. A benign race where two callers both build it on first
/// use is possible but harmless -- the result is deterministic and this only
/// happens once per mode, not per connection.
pub(super) fn get_tls_config(verify_certs: bool) -> Result<Arc<ClientConfig>> {
    static VERIFIED: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    static INSECURE: OnceLock<Arc<ClientConfig>> = OnceLock::new();

    let cell = if verify_certs { &VERIFIED } else { &INSECURE };
    if let Some(cfg) = cell.get() {
        return Ok(cfg.clone());
    }
    let cfg = build_tls_config(verify_certs)?;
    let _ = cell.set(cfg.clone());
    Ok(cell.get().expect("just set").clone())
}
