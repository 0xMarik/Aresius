use crate::types::match_replace::{MatchReplaceRule, MatchReplaceType};
use regex::Regex;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct CompiledMatchRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub rule_type: MatchReplaceType,
    pub match_str: String,
    pub replace_str: String,
    pub is_regex: bool,
    pub is_case_sensitive: bool,
    pub only_in_scope: bool,
    pub compiled_regex: Option<Regex>,
}

impl CompiledMatchRule {
    pub fn from_rule(rule: &MatchReplaceRule) -> Self {
        let is_regex = rule.is_regex.unwrap_or(false);
        let is_case_sensitive = rule.is_case_sensitive.unwrap_or(false);
        let rule_type = MatchReplaceType::from_str_val(&rule.rule_type);

        let compiled_regex = if is_regex && !rule.match_pattern.is_empty() {
            let pattern = if is_case_sensitive {
                rule.match_pattern.clone()
            } else {
                format!("(?i){}", rule.match_pattern)
            };
            Regex::new(&pattern).ok()
        } else {
            None
        };

        Self {
            id: rule.id.clone(),
            name: rule.name.clone(),
            enabled: rule.enabled,
            rule_type,
            match_str: rule.match_pattern.clone(),
            replace_str: rule.replace.clone(),
            is_regex,
            is_case_sensitive,
            only_in_scope: rule.only_in_scope.unwrap_or(true),
            compiled_regex,
        }
    }

    pub fn applies(&self, is_in_scope: bool) -> bool {
        if !self.enabled {
            return false;
        }
        if self.only_in_scope && !is_in_scope {
            return false;
        }
        true
    }

    pub fn replace_in_string(&self, input: &str) -> String {
        if self.match_str.is_empty() {
            return input.to_string();
        }

        if let Some(ref re) = self.compiled_regex {
            re.replace_all(input, self.replace_str.as_str()).to_string()
        } else if self.is_case_sensitive {
            input.replace(&self.match_str, &self.replace_str)
        } else {
            // Case-insensitive literal replacement
            let escaped = regex::escape(&self.match_str);
            if let Ok(re) = Regex::new(&format!("(?i){escaped}")) {
                re.replace_all(input, self.replace_str.as_str()).to_string()
            } else {
                input.replace(&self.match_str, &self.replace_str)
            }
        }
    }
}

#[derive(Default)]
pub struct MatchReplaceEngineState {
    pub rules: Vec<CompiledMatchRule>,
}

#[derive(Clone)]
pub struct MatchReplaceEngine {
    state: Arc<RwLock<MatchReplaceEngineState>>,
}

impl MatchReplaceEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(MatchReplaceEngineState::default())),
        }
    }

    /// Update compiled rules in memory
    pub async fn update_rules(&self, rules: &[MatchReplaceRule]) {
        let compiled: Vec<CompiledMatchRule> = rules
            .iter()
            .map(CompiledMatchRule::from_rule)
            .collect();

        let mut guard = self.state.write().await;
        guard.rules = compiled;
    }

    /// Fast check if any enabled request rule applies
    pub async fn has_request_rules(&self, is_in_scope: bool) -> bool {
        let guard = self.state.read().await;
        guard.rules.iter().any(|r| {
            r.applies(is_in_scope)
                && matches!(
                    r.rule_type,
                    MatchReplaceType::RequestFirstLine
                        | MatchReplaceType::RequestHeader
                        | MatchReplaceType::RequestParamName
                        | MatchReplaceType::RequestParamValue
                        | MatchReplaceType::RequestBody
                )
        })
    }

    /// Fast check if any enabled response rule applies
    pub async fn has_response_rules(&self, is_in_scope: bool) -> bool {
        let guard = self.state.read().await;
        guard.rules.iter().any(|r| {
            r.applies(is_in_scope)
                && matches!(
                    r.rule_type,
                    MatchReplaceType::ResponseHeader | MatchReplaceType::ResponseBody
                )
        })
    }

    /// Fast check if any enabled ResponseBody rule applies
    pub async fn has_response_body_rules(&self, is_in_scope: bool) -> bool {
        let guard = self.state.read().await;
        guard.rules.iter().any(|r| {
            r.applies(is_in_scope) && r.rule_type == MatchReplaceType::ResponseBody
        })
    }

    /// Fast check if any enabled ResponseHeader rule applies
    pub async fn has_response_header_rules(&self, is_in_scope: bool) -> bool {
        let guard = self.state.read().await;
        guard.rules.iter().any(|r| {
            r.applies(is_in_scope) && r.rule_type == MatchReplaceType::ResponseHeader
        })
    }

    /// Apply all matching request rules to raw request bytes without corrupting binary bodies
    pub async fn apply_request_transformations(
        &self,
        raw_request_bytes: &[u8],
        is_in_scope: bool,
    ) -> (Vec<u8>, bool) {
        let sep = raw_request_bytes
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|p| (p, 4))
            .or_else(|| {
                raw_request_bytes
                    .windows(2)
                    .position(|w| w == b"\n\n")
                    .map(|p| (p, 2))
            });

        let (header_bytes, body_bytes) = match sep {
            Some((pos, len)) => (&raw_request_bytes[..pos], &raw_request_bytes[pos + len..]),
            None => (raw_request_bytes, &[][..]),
        };

        let header_str = String::from_utf8_lossy(header_bytes);
        let lines: Vec<String> = header_str
            .lines()
            .map(|s| s.trim_end_matches('\r').to_string())
            .collect();
        if lines.is_empty() {
            return (raw_request_bytes.to_vec(), false);
        }

        let mut first_line = lines[0].clone();
        let mut header_lines = lines[1..].to_vec();

        let guard = self.state.read().await;
        let mut modified = false;
        let mut modified_body: Option<Vec<u8>> = None;

        for rule in guard.rules.iter().filter(|r| r.applies(is_in_scope)) {
            match rule.rule_type {
                MatchReplaceType::RequestFirstLine
                | MatchReplaceType::RequestParamName
                | MatchReplaceType::RequestParamValue => {
                    let updated = rule.replace_in_string(&first_line);
                    if updated != first_line {
                        first_line = updated;
                        modified = true;
                    }
                }
                MatchReplaceType::RequestHeader => {
                    for line in header_lines.iter_mut() {
                        let updated = rule.replace_in_string(line);
                        if updated != *line {
                            *line = updated;
                            modified = true;
                        }
                    }
                }
                MatchReplaceType::RequestBody => {
                    let current_text = modified_body
                        .as_ref()
                        .map(|b| String::from_utf8_lossy(b).to_string())
                        .unwrap_or_else(|| String::from_utf8_lossy(body_bytes).to_string());
                    let updated = rule.replace_in_string(&current_text);
                    if updated != current_text {
                        modified_body = Some(updated.into_bytes());
                        modified = true;
                    }
                }
                _ => {}
            }
        }

        if !modified {
            return (raw_request_bytes.to_vec(), false);
        }

        // Clean empty header lines if any rule removed a header
        header_lines.retain(|l| !l.trim().is_empty());

        let final_body_len = if let Some(ref mb) = modified_body {
            mb.len()
        } else {
            body_bytes.len()
        };

        // Resync Content-Length if body is present or modified
        let mut has_content_length = false;
        for line in header_lines.iter_mut() {
            if line.to_ascii_lowercase().starts_with("content-length:") {
                *line = format!("Content-Length: {}", final_body_len);
                has_content_length = true;
            }
        }

        if !has_content_length && (final_body_len > 0 || sep.is_some()) {
            header_lines.push(format!("Content-Length: {}", final_body_len));
        }

        let mut reconstructed = format!("{}\r\n", first_line);
        for h in header_lines {
            reconstructed.push_str(&format!("{}\r\n", h));
        }
        reconstructed.push_str("\r\n");

        let mut result_bytes = reconstructed.into_bytes();
        if let Some(mb) = modified_body {
            result_bytes.extend_from_slice(&mb);
        } else {
            result_bytes.extend_from_slice(body_bytes);
        }

        (result_bytes, true)
    }

    /// Apply matching response header rules
    pub async fn apply_response_header_transformations(
        &self,
        headers: &str,
        is_in_scope: bool,
    ) -> (String, bool) {
        let lines: Vec<&str> = headers.lines().collect();
        if lines.is_empty() {
            return (headers.to_string(), false);
        }

        let first_line = lines[0].trim_end_matches('\r').to_string();
        let mut header_lines: Vec<String> = lines[1..]
            .iter()
            .map(|l| l.trim_end_matches('\r').to_string())
            .filter(|l| !l.is_empty())
            .collect();

        let guard = self.state.read().await;
        let mut modified = false;

        for rule in guard
            .rules
            .iter()
            .filter(|r| r.applies(is_in_scope) && r.rule_type == MatchReplaceType::ResponseHeader)
        {
            for line in header_lines.iter_mut() {
                let updated = rule.replace_in_string(line);
                if updated != *line {
                    *line = updated;
                    modified = true;
                }
            }
        }

        if !modified {
            return (headers.to_string(), false);
        }

        // Filter out headers that were stripped to empty
        header_lines.retain(|l| !l.trim().is_empty());

        let mut reconstructed = format!("{}\r\n", first_line);
        for h in header_lines {
            reconstructed.push_str(&format!("{}\r\n", h));
        }
        reconstructed.push_str("\r\n");

        (reconstructed, true)
    }

    /// Apply matching response body rules
    pub async fn apply_response_body_transformations(
        &self,
        body: &str,
        is_in_scope: bool,
    ) -> (String, bool) {
        let guard = self.state.read().await;
        let mut current_body = body.to_string();
        let mut modified = false;

        for rule in guard
            .rules
            .iter()
            .filter(|r| r.applies(is_in_scope) && r.rule_type == MatchReplaceType::ResponseBody)
        {
            let updated = rule.replace_in_string(&current_body);
            if updated != current_body {
                current_body = updated;
                modified = true;
            }
        }

        (current_body, modified)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_match_replace_scope_filtering() {
        let engine = MatchReplaceEngine::new();
        let rule = MatchReplaceRule {
            id: "r1".to_string(),
            name: "In scope rule".to_string(),
            enabled: true,
            rule_type: "response_body".to_string(),
            match_pattern: "admin".to_string(),
            replace: "superuser".to_string(),
            comment: "".to_string(),
            is_regex: Some(false),
            is_case_sensitive: Some(false),
            only_in_scope: Some(true),
        };

        engine.update_rules(&[rule]).await;

        // Out of scope -> should not have body rules
        assert!(!engine.has_response_body_rules(false).await);
        // In scope -> should have body rules
        assert!(engine.has_response_body_rules(true).await);

        let (body_out, modified) = engine
            .apply_response_body_transformations("hello admin", false)
            .await;
        assert!(!modified);
        assert_eq!(body_out, "hello admin");

        let (body_in, modified_in) = engine
            .apply_response_body_transformations("hello admin", true)
            .await;
        assert!(modified_in);
        assert_eq!(body_in, "hello superuser");
    }

    #[tokio::test]
    async fn test_request_first_line_and_body_rewrite() {
        let engine = MatchReplaceEngine::new();
        let rule1 = MatchReplaceRule {
            id: "r1".to_string(),
            name: "Rewrite first line".to_string(),
            enabled: true,
            rule_type: "request_first_line".to_string(),
            match_pattern: "GET /api/user".to_string(),
            replace: "GET /api/admin".to_string(),
            comment: "".to_string(),
            is_regex: Some(false),
            is_case_sensitive: Some(false),
            only_in_scope: Some(false),
        };

        let rule2 = MatchReplaceRule {
            id: "r2".to_string(),
            name: "Modify body".to_string(),
            enabled: true,
            rule_type: "request_body".to_string(),
            match_pattern: "\"role\":\"user\"".to_string(),
            replace: "\"role\":\"admin\"".to_string(),
            comment: "".to_string(),
            is_regex: Some(false),
            is_case_sensitive: Some(false),
            only_in_scope: Some(false),
        };

        engine.update_rules(&[rule1, rule2]).await;

        let raw_request = b"GET /api/user HTTP/1.1\r\nHost: example.com\r\nContent-Length: 15\r\n\r\n{\"role\":\"user\"}";
        let (modified, did_mod) = engine.apply_request_transformations(raw_request, true).await;
        assert!(did_mod);

        let mod_str = String::from_utf8(modified).unwrap();
        assert!(mod_str.starts_with("GET /api/admin HTTP/1.1"));
        assert!(mod_str.contains("{\"role\":\"admin\"}"));
        assert!(mod_str.contains("Content-Length: 16"));
    }

    #[tokio::test]
    async fn test_response_header_strip() {
        let engine = MatchReplaceEngine::new();
        let rule = MatchReplaceRule {
            id: "r1".to_string(),
            name: "Strip CSP".to_string(),
            enabled: true,
            rule_type: "response_header".to_string(),
            match_pattern: "Content-Security-Policy: .*".to_string(),
            replace: "".to_string(),
            comment: "".to_string(),
            is_regex: Some(true),
            is_case_sensitive: Some(false),
            only_in_scope: Some(false),
        };

        engine.update_rules(&[rule]).await;

        let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Security-Policy: default-src 'self'\r\nServer: nginx\r\n\r\n";
        let (mod_headers, did_mod) = engine.apply_response_header_transformations(headers, true).await;
        assert!(did_mod);
        assert!(!mod_headers.contains("Content-Security-Policy"));
        assert!(mod_headers.contains("Content-Type: text/html"));
    }

    #[tokio::test]
    async fn test_request_header_rule_preserves_binary_body() {
        let engine = MatchReplaceEngine::new();
        let rule = MatchReplaceRule {
            id: "r1".to_string(),
            name: "Add Header".to_string(),
            enabled: true,
            rule_type: "request_header".to_string(),
            match_pattern: "Host: example.com".to_string(),
            replace: "Host: example.org".to_string(),
            comment: "".to_string(),
            is_regex: Some(false),
            is_case_sensitive: Some(false),
            only_in_scope: Some(false),
        };

        engine.update_rules(&[rule]).await;

        let binary_body = vec![0xFF, 0xFE, 0x00, 0xBA, 0xDE, 0xAD, 0xBE, 0xEF];
        let mut raw_request = b"POST /upload HTTP/1.1\r\nHost: example.com\r\nContent-Length: 8\r\n\r\n".to_vec();
        raw_request.extend_from_slice(&binary_body);

        let (modified, did_mod) = engine.apply_request_transformations(&raw_request, true).await;
        assert!(did_mod);

        // Check that headers were modified
        assert!(String::from_utf8_lossy(&modified).contains("Host: example.org"));

        // Check that binary body at the end remains byte-exact
        let body_offset = modified.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        assert_eq!(&modified[body_offset..], &binary_body[..]);
    }
}

