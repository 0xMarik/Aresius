use crate::ares_utils::httpql::{parse_httpql_with_presets, HttpTransactionEvaluable, HttpqlExpr};
use std::collections::HashMap;
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

pub fn strip_protocol(pattern: &str) -> &str {
    let p = pattern.trim();
    if let Some(rest) = p.strip_prefix("https://") {
        return rest;
    }
    if let Some(rest) = p.strip_prefix("http://") {
        return rest;
    }
    if let Some(rest) = p.strip_prefix("*://") {
        return rest;
    }
    if let Some(rest) = p.strip_prefix("://") {
        return rest;
    }
    if let Some(idx) = p.find("://") {
        return &p[idx + 3..];
    }
    p
}

pub fn host_pattern_to_regex_str(pattern_host: &str) -> String {
    let p = pattern_host.trim();
    if p == "*" || p == "*:*" {
        return "(?i)^.*$".to_string();
    }

    if let Some(base) = p.strip_prefix("*.") {
        let escaped = regex::escape(base);
        return format!("(?i)^(?:(?:[a-zA-Z0-9_.-]+\\.)+)?{}$", escaped);
    }

    if let Some(base) = p.strip_prefix('.') {
        let escaped = regex::escape(base);
        return format!("(?i)^(?:(?:[a-zA-Z0-9_.-]+\\.)+)?{}$", escaped);
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

pub fn path_pattern_to_regex_str(pattern_path: &str) -> String {
    let p = pattern_path.trim();
    if p.is_empty() || p == "/" || p == "/*" {
        return "(?i)^.*$".to_string();
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
    regex.push_str("(?:/.*)?$");
    regex
}

#[derive(Debug, Clone)]
pub struct CompiledScopeRule {
    pub regex: Option<regex::Regex>,
    pub prefix_url: Option<String>,
    pub host_regex: Option<regex::Regex>,
    pub path_regex: Option<regex::Regex>,
    pub has_port: bool,
}

impl CompiledScopeRule {
    pub fn compile(pattern: &str) -> Self {
        let trimmed = pattern.trim();
        if trimmed.is_empty() {
            return Self {
                regex: None,
                prefix_url: None,
                host_regex: None,
                path_regex: None,
                has_port: false,
            };
        }

        // 1. Regex
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

            return Self {
                regex: regex::Regex::new(&regex_pattern).ok(),
                prefix_url: None,
                host_regex: None,
                path_regex: None,
                has_port: false,
            };
        }

        // 2. Prefix URL
        let prefix_url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            Some(trimmed.to_string())
        } else {
            None
        };

        // 3. Glob host / path
        let cleaned = strip_protocol(trimmed);
        let (pattern_host, pattern_path) = match cleaned.find('/') {
            Some(idx) => (&cleaned[..idx], Some(&cleaned[idx..])),
            None => (cleaned, None),
        };

        let (host_regex, has_port) = if !pattern_host.is_empty() {
            let has_port = if pattern_host.starts_with('[') {
                pattern_host.contains("]:")
            } else {
                pattern_host.contains(':')
            };
            let host_regex_str = host_pattern_to_regex_str(pattern_host);
            (regex::Regex::new(&host_regex_str).ok(), has_port)
        } else {
            (None, false)
        };

        let path_regex = match pattern_path {
            Some(p) => {
                let path_regex_str = path_pattern_to_regex_str(p);
                regex::Regex::new(&path_regex_str).ok()
            }
            None => None,
        };

        Self {
            regex: None,
            prefix_url,
            host_regex,
            path_regex,
            has_port,
        }
    }

    pub fn matches(&self, host: &str, path: &str) -> bool {
        let path_to_test = if path.is_empty() { "/" } else { path };
        let bare_host = match host.rfind(':') {
            Some(idx) => &host[..idx],
            None => host,
        };

        // 1. Regex match
        if let Some(ref re) = self.regex {
            let host_with_path = format!("{}{}", host, path_to_test);
            let bare_host_with_path = format!("{}{}", bare_host, path_to_test);
            let https_url = format!("https://{}{}", host, path_to_test);
            let http_url = format!("http://{}{}", host, path_to_test);

            return re.is_match(host)
                || re.is_match(bare_host)
                || re.is_match(&host_with_path)
                || re.is_match(&bare_host_with_path)
                || re.is_match(path_to_test)
                || re.is_match(&https_url)
                || re.is_match(&http_url);
        }

        // 2. Prefix URL match
        if let Some(ref prefix) = self.prefix_url {
            let https_url = format!("https://{}{}", host, path_to_test);
            let http_url = format!("http://{}{}", host, path_to_test);
            if https_url.starts_with(prefix)
                || http_url.starts_with(prefix)
                || format!("https://{}{}", bare_host, path_to_test).starts_with(prefix)
                || format!("http://{}{}", bare_host, path_to_test).starts_with(prefix)
            {
                return true;
            }
        }

        // 3. Host glob match
        if let Some(ref re) = self.host_regex {
            let target_host = if self.has_port { host } else { bare_host };
            if !re.is_match(target_host) && !re.is_match(host) && !re.is_match(bare_host) {
                return false;
            }
        } else {
            return false;
        }

        // 4. Path glob match
        if let Some(ref re) = self.path_regex {
            if !re.is_match(path_to_test) {
                return false;
            }
        }

        true
    }
}

#[derive(Debug, Clone)]
pub struct CompiledScope {
    pub allow: Vec<CompiledScopeRule>,
    pub deny: Vec<CompiledScopeRule>,
}

impl CompiledScope {
    pub fn compile(scope: &ActiveScope) -> Self {
        Self {
            allow: scope
                .allow
                .iter()
                .map(|r| CompiledScopeRule::compile(&r.pattern))
                .collect(),
            deny: scope
                .deny
                .iter()
                .map(|r| CompiledScopeRule::compile(&r.pattern))
                .collect(),
        }
    }

    pub fn is_in_scope(&self, host: &str, path: &str) -> bool {
        if self.allow.is_empty() {
            return false;
        }

        let path = if path.is_empty() { "/" } else { path };

        let allowed = self.allow.iter().any(|rule| rule.matches(host, path));
        if !allowed {
            return false;
        }

        let denied = self.deny.iter().any(|rule| rule.matches(host, path));
        !denied
    }
}

pub fn url_matches_pattern(pattern: &str, host: &str, path: &str) -> bool {
    let rule = CompiledScopeRule::compile(pattern);
    rule.matches(host, path)
}

pub fn is_in_scope(scope: Option<&ActiveScope>, host: &str, path: &str) -> bool {
    let scope = match scope {
        Some(s) => s,
        None => return true,
    };
    let compiled = CompiledScope::compile(scope);
    compiled.is_in_scope(host, path)
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

#[derive(Debug, Clone)]
pub struct InterceptFilterRule {
    pub id: String,
    pub name: String,
    pub expr: HttpqlExpr,
}

pub struct InterceptEvalContext<'a> {
    pub method: &'a str,
    pub host: &'a str,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub extension: Option<&'a str>,
    pub status_code: i64,
    pub response_length: i64,
    pub response_time_ms: i64,
    pub sent_at_ms: i64,
    pub state: &'a str,
    pub is_https: bool,
    pub raw_request: Option<&'a str>,
    pub raw_response: Option<&'a str>,
}

impl<'a> HttpTransactionEvaluable for InterceptEvalContext<'a> {
    fn eval_id(&self) -> u32 { 0 }
    fn eval_method(&self) -> &str { self.method }
    fn eval_host(&self) -> &str { self.host }
    fn eval_path(&self) -> &str { self.path }
    fn eval_query(&self) -> Option<&str> { self.query }
    fn eval_ext(&self) -> Option<&str> { self.extension }
    fn eval_status_code(&self) -> i64 { self.status_code }
    fn eval_response_length(&self) -> i64 { self.response_length }
    fn eval_response_time_ms(&self) -> i64 { self.response_time_ms }
    fn eval_sent_at_ms(&self) -> i64 { self.sent_at_ms }
    fn eval_state(&self) -> &str { self.state }
    fn eval_is_https(&self) -> bool { self.is_https }
    fn eval_raw_request(&self) -> Option<&str> { self.raw_request }
    fn eval_raw_response(&self) -> Option<&str> { self.raw_response }
}

pub struct PendingEntry {
    pub item: InterceptItem,
    pub sender: oneshot::Sender<InterceptDecision>,
}

pub struct InterceptState {
    pub settings: RwLock<InterceptSettings>,
    pub filters: RwLock<Vec<InterceptFilterRule>>,
    pub pending: Mutex<Vec<PendingEntry>>,
}

impl InterceptState {
    pub fn new() -> Self {
        Self {
            settings: RwLock::new(InterceptSettings::default()),
            filters: RwLock::new(Vec::new()),
            pending: Mutex::new(Vec::new()),
        }
    }

    pub async fn update_filters(
        &self,
        filters: Vec<(String, String, String)>,
        all_presets: &HashMap<String, String>,
    ) {
        let mut compiled = Vec::new();
        for (id, name, expr_str) in filters {
            if let Ok(Some(expr)) = parse_httpql_with_presets(&expr_str, all_presets) {
                compiled.push(InterceptFilterRule { id, name, expr });
            }
        }
        let mut current = self.filters.write().await;
        *current = compiled;
    }

    pub async fn should_intercept<T: HttpTransactionEvaluable>(
        &self,
        item_type: InterceptItemType,
        target_host: &str,
        path: &str,
        ctx: &T,
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

        // Evaluate active interception preset filters
        let filters = self.filters.read().await;
        if !filters.is_empty() {
            let mut exclusion_filters = Vec::new();
            let mut positive_filters = Vec::new();

            for filter in filters.iter() {
                let id_lower = filter.id.to_lowercase();
                let name_lower = filter.name.to_lowercase();
                if id_lower.contains("hide-static")
                    || id_lower.contains("no-static")
                    || name_lower.contains("hide static")
                    || name_lower.contains("no static")
                {
                    exclusion_filters.push(filter);
                } else {
                    positive_filters.push(filter);
                }
            }

            // 1. All exclusion/gate filters must pass (e.g. if hide-static is active, static files are rejected)
            for ex in exclusion_filters {
                if !ex.expr.evaluate(ctx) {
                    return false;
                }
            }

            // 2. If positive inclusion filters are active, traffic matching ANY of them is intercepted (OR semantics)
            if !positive_filters.is_empty() {
                let matches_any_positive = positive_filters.iter().any(|f| f.expr.evaluate(ctx));
                if !matches_any_positive {
                    return false;
                }
            }
        }

        true
    }

    pub async fn is_url_in_scope(&self, target_host: &str, path: &str) -> bool {
        let settings = self.settings.read().await;
        let host = target_host.split(':').next().unwrap_or(target_host);
        is_in_scope(settings.active_scope.as_ref(), host, path)
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

        // No scope active -> everything in scope (no restrictions)
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

    #[tokio::test]
    async fn test_interceptor_filter_evaluation() {
        let state = InterceptState::new();
        {
            let mut s = state.settings.write().await;
            s.requests_enabled = true;
            s.responses_enabled = true;
        }

        // Add hide-static filter to active interception filters
        let presets = HashMap::new();
        state
            .update_filters(
                vec![(
                    "hide-static".to_string(),
                    "Hide Static".to_string(),
                    "req.ext.nin:['css', 'js', 'png', 'jpg']".to_string(),
                )],
                &presets,
            )
            .await;

        let api_ctx = InterceptEvalContext {
            method: "GET",
            host: "api.example.com",
            path: "/v1/users",
            query: None,
            extension: None,
            status_code: 200,
            response_length: 120,
            response_time_ms: 50,
            sent_at_ms: 1000,
            state: "",
            is_https: true,
            raw_request: Some("GET /v1/users HTTP/1.1\r\n\r\n"),
            raw_response: None,
        };

        let static_ctx = InterceptEvalContext {
            method: "GET",
            host: "api.example.com",
            path: "/assets/bundle.js",
            query: None,
            extension: Some("js"),
            status_code: 200,
            response_length: 50000,
            response_time_ms: 20,
            sent_at_ms: 1000,
            state: "",
            is_https: true,
            raw_request: Some("GET /assets/bundle.js HTTP/1.1\r\n\r\n"),
            raw_response: None,
        };

        // API request should be intercepted (passes hide-static filter)
        assert!(state.should_intercept(InterceptItemType::Request, "api.example.com", "/v1/users", &api_ctx).await);

        // Static request should NOT be intercepted (blocked by hide-static filter)
        assert!(!state.should_intercept(InterceptItemType::Request, "api.example.com", "/assets/bundle.js", &static_ctx).await);

        // Test multiple active filters: hide-static (exclusion) + errors-only (positive) + json-traffic (positive)
        state
            .update_filters(
                vec![
                    (
                        "hide-static".to_string(),
                        "Hide Static".to_string(),
                        "req.ext.nin:['css', 'js', 'png', 'jpg']".to_string(),
                    ),
                    (
                        "errors-only".to_string(),
                        "Errors Only".to_string(),
                        "resp.code.ge:400".to_string(),
                    ),
                    (
                        "json-traffic".to_string(),
                        "JSON Traffic".to_string(),
                        "preset:\"json-traffic\"".to_string(),
                    ),
                ],
                &presets,
            )
            .await;

        let error_html_ctx = InterceptEvalContext {
            method: "GET",
            host: "api.example.com",
            path: "/error",
            query: None,
            extension: None,
            status_code: 500,
            response_length: 500,
            response_time_ms: 50,
            sent_at_ms: 1000,
            state: "Server Error",
            is_https: true,
            raw_request: Some("GET /error HTTP/1.1\r\n\r\n"),
            raw_response: Some("HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/html\r\n\r\n<h1>Error</h1>"),
        };

        let success_json_ctx = InterceptEvalContext {
            method: "GET",
            host: "api.example.com",
            path: "/api/data.json",
            query: None,
            extension: Some("json"),
            status_code: 200,
            response_length: 50,
            response_time_ms: 50,
            sent_at_ms: 1000,
            state: "Success",
            is_https: true,
            raw_request: Some("GET /api/data.json HTTP/1.1\r\n\r\n"),
            raw_response: Some("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}"),
        };

        let success_html_ctx = InterceptEvalContext {
            method: "GET",
            host: "api.example.com",
            path: "/index.html",
            query: None,
            extension: Some("html"),
            status_code: 200,
            response_length: 500,
            response_time_ms: 50,
            sent_at_ms: 1000,
            state: "Success",
            is_https: true,
            raw_request: Some("GET /index.html HTTP/1.1\r\n\r\n"),
            raw_response: Some("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html></html>"),
        };

        // 500 HTML matches errors-only positive filter -> INTERCEPT
        assert!(state.should_intercept(InterceptItemType::Response, "api.example.com", "/error", &error_html_ctx).await);

        // 200 JSON matches json-traffic positive filter -> INTERCEPT
        assert!(state.should_intercept(InterceptItemType::Response, "api.example.com", "/api/data.json", &success_json_ctx).await);

        // 200 HTML matches neither errors-only nor json-traffic -> BYPASS
        assert!(!state.should_intercept(InterceptItemType::Response, "api.example.com", "/index.html", &success_html_ctx).await);
    }
}
