use std::process::Command;

use crate::ares_utils::certs::CaCertPaths;

// shared helper — requires openssl on PATH (or bundle/vendor it, see note below)
fn get_cert_fingerprint(cert_path: &std::path::Path) -> Result<String, String> {
    let output = Command::new("openssl")
        .args(["x509", "-noout", "-fingerprint", "-sha1", "-in"])
        .arg(cert_path)
        .output()
        .map_err(|e| format!("failed to run openssl: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "openssl failed to read cert: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // format: "sha1 Fingerprint=AA:BB:CC:..."
    stdout
        .split('=')
        .nth(1)
        .map(|s| s.trim().to_uppercase())
        .ok_or_else(|| "unexpected openssl output format".to_string())
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    let fingerprint = get_cert_fingerprint(&paths.cert_path)?;
    let fingerprint_no_colons = fingerprint.replace(':', "");

    let output = Command::new("certutil")
        .args(["-user", "-store", "Root", &fingerprint_no_colons])
        .output()
        .map_err(|e| format!("failed to spawn certutil: {e}"))?;

    Ok(output.status.success())
}

#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    let fingerprint = get_cert_fingerprint(&paths.cert_path)?;
    // security wants "AA:BB:CC..." format for -Z lookups too, same as openssl's output

    let home = std::env::var("HOME").map_err(|e| format!("could not resolve HOME: {e}"))?;
    let keychain = format!("{home}/Library/Keychains/login.keychain-db");

    let output = Command::new("security")
        .args(["find-certificate", "-Z", "-a", &keychain])
        .output()
        .map_err(|e| format!("failed to spawn security: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // -Z prints each cert's SHA-1 hash as "SHA-1 hash: AA BB CC ..." (space-separated, no colons)
    let normalized_fp = fingerprint.replace(':', "");
    let found = stdout
        .lines()
        .filter(|l| l.trim_start().starts_with("SHA-1 hash:"))
        .any(|l| l.replace(' ', "").to_uppercase().ends_with(&normalized_fp));

    Ok(found)
}

#[tauri::command]
#[cfg(target_os = "linux")]
pub fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    let dest = std::path::Path::new("/usr/local/share/ca-certificates/mycert.crt");

    if !dest.exists() {
        return Ok(false);
    }

    let source_fp = get_cert_fingerprint(&paths.cert_path)?;
    let dest_fp = get_cert_fingerprint(dest)?;

    Ok(source_fp == dest_fp)
}
