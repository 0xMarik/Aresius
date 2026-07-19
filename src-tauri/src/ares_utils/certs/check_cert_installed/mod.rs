use crate::ares_utils::certs::CaCertPaths;

use tokio::process::Command;

// shared helper — requires openssl on PATH (or bundle/vendor it, see note below)
async fn get_cert_fingerprint(cert_path: &std::path::Path) -> Result<String, String> {
    let output = Command::new("openssl")
        .args(["x509", "-noout", "-fingerprint", "-sha1", "-in"])
        .arg(cert_path)
        .output()
        .await
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

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    let fingerprint = get_cert_fingerprint(&paths.cert_path).await?;
    let fingerprint_no_colons = fingerprint.replace(':', "");

    let output = Command::new("certutil")
        .args(["-user", "-store", "Root", &fingerprint_no_colons])
        .output()
        .await
        .map_err(|e| format!("failed to spawn certutil: {e}"))?;

    Ok(output.status.success())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    let fingerprint = get_cert_fingerprint(&paths.cert_path).await?;

    let home = std::env::var("HOME").map_err(|e| format!("could not resolve HOME: {e}"))?;
    let keychain = format!("{home}/Library/Keychains/login.keychain-db");

    let output = Command::new("security")
        .args(["find-certificate", "-Z", "-a", &keychain])
        .output()
        .await
        .map_err(|e| format!("failed to spawn security: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let normalized_fp = fingerprint.replace(':', "");
    let found = stdout
        .lines()
        .filter(|l| l.trim_start().starts_with("SHA-1 hash:"))
        .any(|l| l.replace(' ', "").to_uppercase().ends_with(&normalized_fp));

    Ok(found)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn check_cert_installed(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    let dest = std::path::Path::new("/usr/local/share/ca-certificates/mycert.crt");

    if !dest.exists() {
        return Ok(false);
    }

    let source_fp = get_cert_fingerprint(&paths.cert_path).await?;
    let dest_fp = get_cert_fingerprint(dest).await?;

    Ok(source_fp == dest_fp)
}
