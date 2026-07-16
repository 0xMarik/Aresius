use crate::ares_utils::certs::CaCertPaths;
use std::process::Command;

#[tauri::command]
#[cfg(target_os = "windows")]
pub fn install_cert(app: tauri::AppHandle) -> Result<(), String> {
    tracing::info!("Installing certificate on Windows...");
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;

    let status = Command::new("certutil")
        .args([
            "-addstore",
            "-user",
            "Root",
            &paths.cert_path.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("failed to spawn certutil: {e}"))?;

    if !status.success() {
        return Err(format!(
            "certutil exited with {}",
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown code (terminated by signal)".into())
        ));
    }

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "macos")]
pub fn install_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;

    let home = std::env::var("HOME").map_err(|e| format!("could not resolve HOME: {e}"))?;
    let keychain = format!("{home}/Library/Keychains/login.keychain-db");

    let output = Command::new("security")
        .args([
            "add-trusted-cert",
            "-r",
            "trustRoot",
            "-k",
            &keychain,
            &paths.cert_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("failed to spawn security: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "security add-trusted-cert failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "linux")]
pub fn install_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    let dest = "/usr/local/share/ca-certificates/mycert.crt";

    std::fs::copy(&paths.cert_path, dest)
        .map_err(|e| format!("failed to copy cert to {dest}: {e}"))?;

    let output = Command::new("update-ca-certificates")
        .output()
        .map_err(|e| format!("failed to spawn update-ca-certificates: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "update-ca-certificates failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}
