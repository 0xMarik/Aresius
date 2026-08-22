use crate::ares_utils::certs::{read_cert_der_from_file, CaCertPaths};
#[cfg(target_os = "macos")]
use sha1::{Digest, Sha1};

#[cfg(target_os = "macos")]
fn get_der_fingerprint_hex(der: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(der);
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02X}", b)).collect()
}

fn check_cert_in_native_roots(der_bytes: &[u8]) -> bool {
    let native_certs = rustls_native_certs::load_native_certs();
    native_certs.certs.iter().any(|c| c.as_ref() == der_bytes)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = match CaCertPaths::new(&app) {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };

    if !paths.cert_path.exists() {
        return Ok(false);
    }

    let der_bytes = match read_cert_der_from_file(&paths.cert_path) {
        Ok(der) => der,
        Err(_) => return Ok(false),
    };

    // Fast path: In-process trust verification via rustls-native-certs
    if check_cert_in_native_roots(&der_bytes) {
        return Ok(true);
    }

    // Direct Windows CryptoAPI check (pure Rust FFI, no CLI subprocess)
    Ok(crate::ares_utils::certs::win_crypto::win_cert_store::is_ca_in_user_root_store(&der_bytes))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = match CaCertPaths::new(&app) {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };

    if !paths.cert_path.exists() {
        return Ok(false);
    }

    let der_bytes = match read_cert_der_from_file(&paths.cert_path) {
        Ok(der) => der,
        Err(_) => return Ok(false),
    };

    if check_cert_in_native_roots(&der_bytes) {
        return Ok(true);
    }

    let fingerprint_hex = get_der_fingerprint_hex(&der_bytes);
    let home = std::env::var("HOME").unwrap_or_default();
    let mut keychain = format!("{home}/Library/Keychains/login.keychain-db");
    if !std::path::Path::new(&keychain).exists() {
        keychain = format!("{home}/Library/Keychains/login.keychain");
    }

    let output = tokio::process::Command::new("security")
        .args(["find-certificate", "-Z", "-a", &keychain])
        .output()
        .await;

    if let Ok(res) = output {
        let stdout = String::from_utf8_lossy(&res.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if let Some(hash_part) = trimmed.strip_prefix("SHA-1 hash:") {
                let normalized = hash_part.replace([' ', ':', '\t'], "").to_uppercase();
                if normalized == fingerprint_hex {
                    return Ok(true);
                }
            }
        }
    }

    Ok(false)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = match CaCertPaths::new(&app) {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };

    if !paths.cert_path.exists() {
        return Ok(false);
    }

    let der_bytes = match read_cert_der_from_file(&paths.cert_path) {
        Ok(der) => der,
        Err(_) => return Ok(false),
    };

    if check_cert_in_native_roots(&der_bytes) {
        return Ok(true);
    }

    let dest = std::path::Path::new("/usr/local/share/ca-certificates/aresius-ca.crt");
    if dest.exists() {
        if let Ok(dest_der) = read_cert_der_from_file(dest) {
            if dest_der == der_bytes {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
#[tauri::command]
pub async fn check_cert_installed(_app: tauri::AppHandle) -> Result<bool, String> {
    Ok(false)
}



