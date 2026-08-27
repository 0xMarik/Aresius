fn main() {
    #[cfg(windows)]
    {
        let mut windows = tauri_build::WindowsAttributes::new();
        let file_icon = std::path::Path::new("icons/file-icon/icon.ico");
        if file_icon.exists() {
            windows = windows.append_rc_content(format!("32513 ICON \"{}\"", "icons/file-icon/icon.ico"));
        }
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("failed to run tauri-build");
    }
    #[cfg(not(windows))]
    {
        tauri_build::build();
    }
}
