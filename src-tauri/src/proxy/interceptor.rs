use tokio::sync::{oneshot, Mutex, RwLock};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterceptItemType {
    Request,
    Response,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptSettings {
    pub requests_enabled: bool,
    pub responses_enabled: bool,
}

impl Default for InterceptSettings {
    fn default() -> Self {
        Self {
            requests_enabled: false,
            responses_enabled: false,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptItem {
    pub id: String,
    pub item_type: InterceptItemType,
    pub host: String,
    pub method_or_status: String,
    pub raw_message: String,
    pub timestamp: u128,
    pub is_https: bool,
}

#[derive(Debug)]
pub enum InterceptDecision {
    Forward { modified_message: Option<String> },
    Drop,
}

pub struct PendingEntry {
    pub item: InterceptItem,
    pub sender: oneshot::Sender<InterceptDecision>,
}

pub struct InterceptState {
    pub settings: RwLock<InterceptSettings>,
    pub pending: Mutex<Vec<PendingEntry>>,
}

impl InterceptState {
    pub fn new() -> Self {
        Self {
            settings: RwLock::new(InterceptSettings::default()),
            pending: Mutex::new(Vec::new()),
        }
    }

    pub async fn should_intercept(&self, item_type: InterceptItemType) -> bool {
        let settings = self.settings.read().await;
        match item_type {
            InterceptItemType::Request => settings.requests_enabled,
            InterceptItemType::Response => settings.responses_enabled,
        }
    }

    pub async fn add_and_await(
        &self,
        item: InterceptItem,
    ) -> Option<InterceptDecision> {
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.push(PendingEntry {
                item,
                sender: tx,
            });
        }

        // Wait indefinitely while held pending user action.
        // Narrowly scopes client timeout suspension to this held channel await.
        rx.await.ok()
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardPayload {
    pub id: String,
    pub modified_message: Option<String>,
}

/// Helper function to validate HTTP message syntax before forwarding.
pub fn validate_http_message(raw_msg: &str, is_request: bool) -> Result<(), String> {
    if raw_msg.trim().is_empty() {
        return Err("HTTP message cannot be empty".to_string());
    }

    let mut lines = raw_msg.lines();
    let first_line = lines.next().ok_or("Missing start line")?;

    if is_request {
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() < 2 {
            return Err("Malformed HTTP request line (e.g. GET /path HTTP/1.1 expected)".to_string());
        }
    } else {
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() < 2 || !parts[0].starts_with("HTTP/") {
            return Err("Malformed HTTP response status line (e.g. HTTP/1.1 200 OK expected)".to_string());
        }
    }

    Ok(())
}

/// Helper function to extract method/URL for request or status line for response.
pub fn extract_method_or_status(raw_msg: &str, is_request: bool) -> String {
    let first_line = raw_msg.lines().next().unwrap_or("").trim();
    if is_request {
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 2 {
            format!("{} {}", parts[0], parts[1])
        } else if !parts.is_empty() {
            parts[0].to_string()
        } else {
            "GET".to_string()
        }
    } else {
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 2 && parts[0].starts_with("HTTP/") {
            parts[1..].join(" ")
        } else {
            first_line.to_string()
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri IPC Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_intercept_settings(
    state: tauri::State<'_, InterceptState>,
) -> Result<InterceptSettings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn set_intercept_settings(
    state: tauri::State<'_, InterceptState>,
    settings: InterceptSettings,
) -> Result<(), String> {
    let mut current = state.settings.write().await;
    *current = settings;
    Ok(())
}

#[tauri::command]
pub async fn get_intercept_queue(
    state: tauri::State<'_, InterceptState>,
) -> Result<Vec<InterceptItem>, String> {
    let pending = state.pending.lock().await;
    let items = pending.iter().map(|entry| entry.item.clone()).collect();
    Ok(items)
}

#[tauri::command]
pub async fn forward_intercept_item(
    state: tauri::State<'_, InterceptState>,
    payload: ForwardPayload,
) -> Result<(), String> {
    let mut pending = state.pending.lock().await;
    if let Some(pos) = pending.iter().position(|e| e.item.id == payload.id) {
        let entry = pending.remove(pos);
        if let Some(ref mod_msg) = payload.modified_message {
            let is_req = matches!(entry.item.item_type, InterceptItemType::Request);
            validate_http_message(mod_msg, is_req)?;
        }
        let _ = entry.sender.send(InterceptDecision::Forward {
            modified_message: payload.modified_message,
        });
        Ok(())
    } else {
        Err(format!("Item ID {} not found in queue", payload.id))
    }
}

#[tauri::command]
pub async fn drop_intercept_item(
    state: tauri::State<'_, InterceptState>,
    id: String,
) -> Result<(), String> {
    let mut pending = state.pending.lock().await;
    if let Some(pos) = pending.iter().position(|e| e.item.id == id) {
        let entry = pending.remove(pos);
        let _ = entry.sender.send(InterceptDecision::Drop);
        Ok(())
    } else {
        Err(format!("Item ID {} not found in queue", id))
    }
}

#[tauri::command]
pub async fn drop_all_intercept_items(
    state: tauri::State<'_, InterceptState>,
) -> Result<(), String> {
    let mut pending = state.pending.lock().await;
    let entries: Vec<PendingEntry> = pending.drain(..).collect();
    for entry in entries {
        let _ = entry.sender.send(InterceptDecision::Drop);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_http_request() {
        assert!(validate_http_message("GET /test HTTP/1.1\r\nHost: example.com\r\n\r\n", true).is_ok());
        assert!(validate_http_message("INVALID", true).is_err());
        assert!(validate_http_message("", true).is_err());
    }

    #[test]
    fn test_validate_http_response() {
        assert!(validate_http_message("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", false).is_ok());
        assert!(validate_http_message("200 OK", false).is_err());
    }
}
