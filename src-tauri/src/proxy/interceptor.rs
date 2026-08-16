use tokio::sync::{oneshot, Mutex, RwLock};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterceptItemType {
    Request,
    Response,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRule {
    pub id: String,
    pub pattern: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveScope {
    pub id: String,
    pub name: String,
    pub color: String,
    pub allow: Vec<ScopeRule>,
    pub deny: Vec<ScopeRule>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptSettings {
    pub requests_enabled: bool,
    pub responses_enabled: bool,
    #[serde(default)]
    pub scope_filter_enabled: bool,
    #[serde(default)]
    pub active_scope: Option<ActiveScope>,
}

impl Default for InterceptSettings {
    fn default() -> Self {
        Self {
            requests_enabled: false,
            responses_enabled: false,
            scope_filter_enabled: false,
            active_scope: None,
        }
    }
}

pub fn is_regex_pattern(pattern: &str) -> bool {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with('^')
        || trimmed.ends_with('$')
        || trimmed.starts_with("regex:")
        || trimmed.starts_with("(?i)")
    {
        return true;
    }
    // Check if pattern contains typical regex constructs
    if trimmed.contains("\\.")
        || trimmed.contains("\\d")
        || trimmed.contains("\\w")
        || trimmed.contains(".*")
        || trimmed.contains(".+")
        || trimmed.contains('|')
        || (trimmed.contains('(') && trimmed.contains(')'))
        || (trimmed.contains('[') && trimmed.contains(']'))
    {
        return true;
    }
    false
}

pub fn pattern_to_regex_str(pattern: &str) -> String {
    let p = pattern.trim();
    if p == "*" || p == "*:*" {
        return "(?i)^.*$".to_string();
    }

    if let Some(base) = p.strip_prefix("*.") {
        let escaped = regex::escape(base);
        return format!("(?i)^(?:[a-zA-Z0-9_.-]+\\.)+{}$", escaped);
    }

    if let Some(base) = p.strip_prefix('.') {
        let escaped = regex::escape(base);
        return format!("(?i)^(?:[a-zA-Z0-9_.-]+\\.)+{}$", escaped);
    }

    let mut regex = String::from("(?i)^");
    for c in p.chars() {
        match c {
            '*' => regex.push_str(".*"),
            '.' | '+' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\' | '?' => {
                regex.push('\\');
                regex.push(c);
            }
            _ => regex.push(c),
        }
    }
    regex.push('$');
    regex
}

pub fn url_matches_pattern(pattern: &str, host: &str, path: &str) -> bool {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return false;
    }

    let path_to_test = if path.is_empty() { "/" } else { path };
    let bare_host = match host.rfind(':') {
        Some(idx) => &host[..idx],
        None => host,
    };
    let host_with_path = format!("{}{}", host, path_to_test);
    let bare_host_with_path = format!("{}{}", bare_host, path_to_test);
    let https_url = format!("https://{}{}", host, path_to_test);
    let http_url = format!("http://{}{}", host, path_to_test);

    // 1. If it's a regex pattern
    if is_regex_pattern(trimmed) {
        let regex_src = if let Some(stripped) = trimmed.strip_prefix("regex:") {
            stripped.trim()
        } else {
            trimmed
        };
        let regex_pattern = if regex_src.starts_with("(?i)") {
            regex_src.to_string()
        } else {
            format!("(?i){}", regex_src)
        };

        if let Ok(re) = regex::Regex::new(&regex_pattern) {
            return re.is_match(host)
                || re.is_match(bare_host)
                || re.is_match(&host_with_path)
                || re.is_match(&bare_host_with_path)
                || re.is_match(path_to_test)
                || re.is_match(&https_url)
                || re.is_match(&http_url);
        }
    }

    // 2. Prefix URL matching (e.g. "https://example.com/api")
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        if https_url.starts_with(trimmed)
            || http_url.starts_with(trimmed)
            || format!("https://{}{}", bare_host, path_to_test).starts_with(trimmed)
            || format!("http://{}{}", bare_host, path_to_test).starts_with(trimmed)
        {
            return true;
        }
    }

    // 3. Glob matching
    let (pattern_host, pattern_path) = match trimmed.find('/') {
        Some(idx) => (&trimmed[..idx], Some(&trimmed[idx..])),
        None => (trimmed, None),
    };

    let host_regex_str = pattern_to_regex_str(pattern_host);
    if let Ok(re) = regex::Regex::new(&host_regex_str) {
        if !re.is_match(host) && !re.is_match(bare_host) {
            return false;
        }
    } else {
        return false;
    }

    let pattern_path = match pattern_path {
        Some(p) => p,
        None => return true,
    };

    let path_regex_str = pattern_to_regex_str(pattern_path);
    if let Ok(re) = regex::Regex::new(&path_regex_str) {
        re.is_match(path_to_test)
    } else {
        false
    }
}

pub fn is_in_scope(scope: Option<&ActiveScope>, host: &str, path: &str) -> bool {
    let scope = match scope {
        Some(s) => s,
        None => return true,
    };

    if scope.allow.is_empty() {
        return false;
    }

    let path = if path.is_empty() { "/" } else { path };

    let allowed = scope
        .allow
        .iter()
        .any(|rule| url_matches_pattern(&rule.pattern, host, path));
    if !allowed {
        return false;
    }

    let denied = scope
        .deny
        .iter()
        .any(|rule| url_matches_pattern(&rule.pattern, host, path));

    !denied
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

    pub async fn should_intercept(
        &self,
        item_type: InterceptItemType,
        target_host: &str,
        path: &str,
    ) -> bool {
        let settings = self.settings.read().await;
        let enabled = match item_type {
            InterceptItemType::Request => settings.requests_enabled,
            InterceptItemType::Response => settings.responses_enabled,
        };

        if !enabled {
            return false;
        }

        if settings.scope_filter_enabled {
            let host = target_host.split(':').next().unwrap_or(target_host);
            if !is_in_scope(settings.active_scope.as_ref(), host, path) {
                return false;
            }
        }

        true
    }

    pub async fn add_and_await(&self, item: InterceptItem) -> Option<InterceptDecision> {
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.push(PendingEntry { item, sender: tx });
        }

        // Wait indefinitely while held pending user action.
        // Narrowly scopes client timeout suspension to this held channel await.
        rx.await.ok()
    }
}

impl Default for InterceptState {
    fn default() -> Self {
        Self::new()
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
            return Err(
                "Malformed HTTP request line (e.g. GET /path HTTP/1.1 expected)".to_string(),
            );
        }
    } else {
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() < 2 || !parts[0].starts_with("HTTP/") {
            return Err(
                "Malformed HTTP response status line (e.g. HTTP/1.1 200 OK expected)".to_string(),
            );
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
    fn test_url_matches_pattern() {
        // Host only matching
        assert!(url_matches_pattern("*.example.com", "sub.example.com", "/"));
        assert!(url_matches_pattern("example.com", "example.com", "/api"));
        assert!(!url_matches_pattern("example.com", "other.com", "/"));

        // Host + Path matching
        assert!(url_matches_pattern("example.com/api/*", "example.com", "/api/v1"));
        assert!(!url_matches_pattern("example.com/api/*", "example.com", "/admin"));

        // Regex matching
        assert!(url_matches_pattern("^.*\\.example\\.com$", "sub.example.com", "/"));
        assert!(url_matches_pattern("^.*\\.example\\.com/api/.*$", "sub.example.com", "/api/v1/users"));
        assert!(!url_matches_pattern("^.*\\.example\\.com/api/.*$", "sub.example.com", "/auth/login"));
        assert!(url_matches_pattern("^api-(v1|v2)\\.target\\.com$", "api-v1.target.com", "/"));
        assert!(!url_matches_pattern("^api-(v1|v2)\\.target\\.com$", "api-v3.target.com", "/"));

        // Prefix URL matching
        assert!(url_matches_pattern("https://example.com/api", "example.com", "/api/users"));
        assert!(!url_matches_pattern("https://example.com/api", "example.com", "/other"));
    }

    #[test]
    fn test_is_in_scope() {
        let scope = ActiveScope {
            id: "1".to_string(),
            name: "Test Scope".to_string(),
            color: "#fff".to_string(),
            allow: vec![
                ScopeRule {
                    id: "r1".to_string(),
                    pattern: "*.example.com".to_string(),
                },
                ScopeRule {
                    id: "r2".to_string(),
                    pattern: "target.com/api/*".to_string(),
                },
                ScopeRule {
                    id: "r3".to_string(),
                    pattern: "^.*\\.regex-target\\.com/v[0-9]+/.*$".to_string(),
                },
            ],
            deny: vec![
                ScopeRule {
                    id: "d1".to_string(),
                    pattern: "secret.example.com".to_string(),
                },
                ScopeRule {
                    id: "d2".to_string(),
                    pattern: "^.*\\.regex-target\\.com/v[0-9]+/admin.*$".to_string(),
                },
            ],
        };

        // No scope active -> everything in scope
        assert!(is_in_scope(None, "anything.com", "/"));

        // In scope via allow rule 1
        assert!(is_in_scope(Some(&scope), "app.example.com", "/test"));

        // Out of scope via deny rule
        assert!(!is_in_scope(Some(&scope), "secret.example.com", "/test"));

        // In scope via allow rule 2
        assert!(is_in_scope(Some(&scope), "target.com", "/api/users"));

        // Out of scope (not matching allow rule 2 path)
        assert!(!is_in_scope(Some(&scope), "target.com", "/dashboard"));

        // In scope via regex allow rule 3
        assert!(is_in_scope(Some(&scope), "api.regex-target.com", "/v1/items"));

        // Out of scope via regex deny rule d2
        assert!(!is_in_scope(Some(&scope), "api.regex-target.com", "/v1/admin/delete"));

        // Out of scope (host not in allow list)
        assert!(!is_in_scope(Some(&scope), "google.com", "/"));
    }

    #[test]
    fn test_validate_http_request() {
        assert!(
            validate_http_message("GET /test HTTP/1.1\r\nHost: example.com\r\n\r\n", true).is_ok()
        );
        assert!(validate_http_message("INVALID", true).is_err());
        assert!(validate_http_message("", true).is_err());
    }

    #[test]
    fn test_validate_http_response() {
        assert!(
            validate_http_message("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", false).is_ok()
        );
        assert!(validate_http_message("200 OK", false).is_err());
    }
}
