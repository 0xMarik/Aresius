use crate::ares_utils::certs::{ensure_ca_cert_exists, CaCertPaths};
use std::path::Path;
#[cfg(not(target_os = "windows"))]
use tokio::process::Command;

#[cfg(target_os = "windows")]
pub async fn remove_cert_from_os_store(cert_path: &Path) -> Result<(), String> {
    let der_opt = crate::ares_utils::certs::read_cert_der_from_file(cert_path).ok();
    crate::ares_utils::certs::win_crypto::win_cert_store::remove_ca_from_user_root_store(
        der_opt.as_deref(),
    )
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn uninstall_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    remove_cert_from_os_store(&paths.cert_path).await
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn install_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = ensure_ca_cert_exists(&app).map_err(|e| e.to_string())?;
    let der = crate::ares_utils::certs::read_cert_der_from_file(&paths.cert_path)?;
    crate::ares_utils::certs::win_crypto::win_cert_store::install_ca_to_user_root_store(&der)
}


#[cfg(target_os = "macos")]
pub async fn remove_cert_from_os_store(_cert_path: &Path) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut keychain = format!("{home}/Library/Keychains/login.keychain-db");
    if !Path::new(&keychain).exists() {
        keychain = format!("{home}/Library/Keychains/login.keychain");
    }

    let _ = Command::new("security")
        .args(["delete-certificate", "-c", "Aresius CA", &keychain])
        .output()
        .await;

    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn uninstall_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    remove_cert_from_os_store(&paths.cert_path).await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn install_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = ensure_ca_cert_exists(&app).map_err(|e| e.to_string())?;

    let home = std::env::var("HOME").map_err(|e| format!("could not resolve HOME: {e}"))?;
    let mut keychain = format!("{home}/Library/Keychains/login.keychain-db");
    if !Path::new(&keychain).exists() {
        keychain = format!("{home}/Library/Keychains/login.keychain");
    }

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
        .await
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

#[cfg(target_os = "linux")]
pub async fn remove_cert_from_os_store(_cert_path: &Path) -> Result<(), String> {
    let dest_file = "/usr/local/share/ca-certificates/aresius-ca.crt";
    if Path::new(dest_file).exists() {
        let _ = Command::new("pkexec")
            .args(["rm", "-f", dest_file])
            .output()
            .await;
        let _ = Command::new("pkexec")
            .args(["update-ca-certificates", "--fresh"])
            .output()
            .await;
    }

    if let Ok(home) = std::env::var("HOME") {
        let nssdb = format!("{home}/.pki/nssdb");
        if Path::new(&nssdb).exists() {
            let _ = Command::new("certutil")
                .args(["-d", &format!("sql:{nssdb}"), "-D", "-n", "Aresius CA"])
                .output()
                .await;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn uninstall_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = CaCertPaths::new(&app).map_err(|e| e.to_string())?;
    remove_cert_from_os_store(&paths.cert_path).await
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn install_cert(app: tauri::AppHandle) -> Result<(), String> {
    let paths = ensure_ca_cert_exists(&app).map_err(|e| e.to_string())?;
    let dest_file = "/usr/local/share/ca-certificates/aresius-ca.crt";

    // Direct pkexec without bash -c shell interpolation
    let copy_output = Command::new("pkexec")
        .args(["cp", &paths.cert_path.to_string_lossy(), dest_file])
        .output()
        .await;

    match copy_output {
        Ok(res) if res.status.success() => {
            let _ = Command::new("pkexec")
                .args(["update-ca-certificates"])
                .output()
                .await;

            // Also install into NSS db for Chrome/Chromium if ~/.pki/nssdb exists
            if let Ok(home) = std::env::var("HOME") {
                let nssdb = format!("{home}/.pki/nssdb");
                if Path::new(&nssdb).exists() {
                    let _ = Command::new("certutil")
                        .args([
                            "-d",
                            &format!("sql:{nssdb}"),
                            "-A",
                            "-t",
                            "C,,",
                            "-n",
                            "Aresius CA",
                            "-i",
                            &paths.cert_path.to_string_lossy(),
                        ])
                        .output()
                        .await;
                }
            }
            Ok(())
        }
        Ok(res) => {
            let stderr = String::from_utf8_lossy(&res.stderr);
            Err(format!(
                "Failed to install certificate: {stderr}. Manual command: sudo cp '{}' /usr/local/share/ca-certificates/aresius-ca.crt && sudo update-ca-certificates",
                paths.cert_path.display()
            ))
        }
        Err(e) => {
            Err(format!(
                "Failed to run pkexec ({e}). Manual command: sudo cp '{}' /usr/local/share/ca-certificates/aresius-ca.crt && sudo update-ca-certificates",
                paths.cert_path.display()
            ))
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub async fn remove_cert_from_os_store(_cert_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
#[tauri::command]
pub async fn uninstall_cert(_app: tauri::AppHandle) -> Result<(), String> {
    Err("Certificate uninstallation is not supported on this platform".into())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
#[tauri::command]
pub async fn install_cert(_app: tauri::AppHandle) -> Result<(), String> {
    Err("Certificate installation is not supported on this platform".into())
}




