#[cfg(windows)]
pub fn register_windows_file_association(app: &tauri::AppHandle) {
    use std::path::PathBuf;
    use winreg::enums::*;
    use winreg::RegKey;
    use tauri::Manager;

    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Failed to get current exe path for file association: {}", e);
            return;
        }
    };
    let exe_str = current_exe.to_string_lossy().to_string();

    // Determine the best file icon path
    let mut icon_target = format!("\"{}\",1", exe_str);

    // Check potential standalone .ico paths
    let mut candidate_paths: Vec<PathBuf> = Vec::new();

    if let Ok(res_dir) = app.path().resource_dir() {
        candidate_paths.push(res_dir.join("icons").join("file-icon").join("icon.ico"));
        candidate_paths.push(res_dir.join("file-icon.ico"));
        candidate_paths.push(res_dir.join("resources").join("icons").join("file-icon").join("icon.ico"));
    }

    if let Some(exe_dir) = current_exe.parent() {
        candidate_paths.push(exe_dir.join("file-icon.ico"));
        candidate_paths.push(exe_dir.join("icons").join("file-icon").join("icon.ico"));
        candidate_paths.push(exe_dir.join("resources").join("icons").join("file-icon").join("icon.ico"));
    }

    // Dev environment candidate
    candidate_paths.push(PathBuf::from("icons/file-icon/icon.ico"));

    for path in candidate_paths {
        if path.exists() {
            if let Ok(canonical) = path.canonicalize() {
                let p_str = canonical.to_string_lossy().replace(r"\\?\", "");
                icon_target = format!("\"{}\"", p_str);
                break;
            }
        }
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // 1. HKCU\Software\Classes\.ares
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\.ares") {
        let _ = key.set_value("", &"ares");
        let _ = key.set_value("Content Type", &"application/x-ares");
    }

    // 2. HKCU\Software\Classes\.ares\OpenWithProgids
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\.ares\OpenWithProgids") {
        let _ = key.set_value("ares", &"");
        let _ = key.set_value("Ares File", &"");
    }

    // 3. HKCU\Software\Classes\ares
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\ares") {
        let _ = key.set_value("", &"Aresius Project File");
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\ares\DefaultIcon") {
        let _ = key.set_value("", &icon_target);
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\ares\shell\open") {
        let _ = key.set_value("", &"Open with Aresius");
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\ares\shell\open\command") {
        let cmd = format!("\"{}\" \"%1\"", exe_str);
        let _ = key.set_value("", &cmd);
    }

    // 4. HKCU\Software\Classes\Ares File
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\Ares File") {
        let _ = key.set_value("", &"Aresius Project File");
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\Ares File\DefaultIcon") {
        let _ = key.set_value("", &icon_target);
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\Ares File\shell\open\command") {
        let cmd = format!("\"{}\" \"%1\"", exe_str);
        let _ = key.set_value("", &cmd);
    }

    // 5. HKCU\Software\Classes\Applications\Aresius.exe
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\Applications\Aresius.exe") {
        let _ = key.set_value("FriendlyAppName", &"Aresius");
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\Applications\Aresius.exe\SupportedTypes") {
        let _ = key.set_value(".ares", &"");
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\Applications\Aresius.exe\DefaultIcon") {
        let _ = key.set_value("", &icon_target);
    }
    if let Ok((key, _)) = hkcu.create_subkey(r"Software\Classes\Applications\Aresius.exe\shell\open\command") {
        let cmd = format!("\"{}\" \"%1\"", exe_str);
        let _ = key.set_value("", &cmd);
    }

    // 6. Notify Windows Shell of association and icon changes
    unsafe {
        use std::ffi::c_void;
        #[link(name = "shell32")]
        extern "system" {
            fn SHChangeNotify(w_event_id: i32, u_flags: u32, dw_item1: *const c_void, dw_item2: *const c_void);
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x08000000;
        const SHCNF_IDLIST: u32 = 0x0000;
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
    }

    tracing::info!("Registered Windows file association for .ares with icon: {}", icon_target);
}

#[cfg(not(windows))]
pub fn register_windows_file_association(_app: &tauri::AppHandle) {}
