use crate::types::{HighlightRange, SessionPayload};

pub fn building_raw_request(
    raw_request: &str,
    param_value: &str,
    highlight_range: &HighlightRange,
) -> String {
    let from = highlight_range.byte_from as usize;
    let to = highlight_range.byte_to as usize;

    // Build the new request by concatenating:
    // 1. Everything before 'from'
    // 2. The param_value
    // 3. Everything after 'to'
    let mut result = String::new();
    result.push_str(&raw_request[..from]);
    result.push_str(param_value);
    result.push_str(&raw_request[to..]);

    result
}

/// Formats a raw HTTP fuzz request by applying connection and content-length header adjustments.
pub fn format_fuzz_request(
    raw_request: &str,
    set_keep_alive: bool,
    update_content_length: bool,
) -> String {
    if !set_keep_alive && !update_content_length {
        return raw_request.to_string();
    }

    // Locate header terminator (\r\n\r\n or \n\n)
    let (header_part, terminator, body_part) = if let Some(pos) = raw_request.find("\r\n\r\n") {
        (&raw_request[..pos], "\r\n\r\n", &raw_request[pos + 4..])
    } else if let Some(pos) = raw_request.find("\n\n") {
        (&raw_request[..pos], "\n\n", &raw_request[pos + 2..])
    } else {
        (raw_request, "\r\n\r\n", "")
    };

    let uses_crlf = header_part.contains("\r\n") || terminator == "\r\n\r\n";
    let line_delim = if uses_crlf { "\r\n" } else { "\n" };

    let mut lines: Vec<String> = header_part.lines().map(|s| s.to_string()).collect();
    if lines.is_empty() {
        return raw_request.to_string();
    }

    // 1. Update Connection header if requested
    if set_keep_alive {
        let mut connection_found = false;
        for line in &mut lines {
            let lower = line.to_ascii_lowercase();
            if lower.starts_with("connection:") {
                *line = "Connection: keep-alive".to_string();
                connection_found = true;
                break;
            }
        }
        if !connection_found && lines.len() >= 1 {
            // Insert right below the request line
            lines.insert(1, "Connection: keep-alive".to_string());
        }
    }

    // 2. Update Content-Length header if requested
    if update_content_length {
        let actual_body_len = body_part.as_bytes().len();
        let mut cl_found = false;
        for line in &mut lines {
            let lower = line.to_ascii_lowercase();
            if lower.starts_with("content-length:") {
                *line = format!("Content-Length: {}", actual_body_len);
                cl_found = true;
                break;
            }
        }
        if !cl_found && actual_body_len > 0 && lines.len() >= 1 {
            lines.push(format!("Content-Length: {}", actual_body_len));
        }
    }

    let formatted_headers = lines.join(line_delim);
    format!("{}{}{}", formatted_headers, terminator, body_part)
}

/// Reconstructs a complete raw HTTP request on the fly from the snapshot template and payload.
pub fn reconstruct_fuzzer_request(
    config: &SessionPayload,
    payload: Option<&str>,
    target_id: &str,
) -> String {
    let raw_request = &config.raw_request;
    if config.parameters.is_empty() {
        let keep_alive = config.set_connection_keep_alive.unwrap_or(true);
        let update_cl = config.update_content_length.unwrap_or(true);
        return format_fuzz_request(raw_request, keep_alive, update_cl);
    }

    let attack_type = config
        .fuzzing_attack_type
        .as_deref()
        .unwrap_or("rotator")
        .to_lowercase();

    let keep_alive = config.set_connection_keep_alive.unwrap_or(true);
    let update_cl = config.update_content_length.unwrap_or(true);

    let mut modified = raw_request.clone();

    match attack_type.as_str() {
        "rotator" => {
            let param_idx = target_id
                .split('-')
                .next()
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(0);

            if let Some(param) = config.parameters.get(param_idx) {
                let val = payload.unwrap_or(&param.highlight_range.original_text);
                modified = building_raw_request(&modified, val, &param.highlight_range);
            }
        }
        "echo" => {
            let mut sorted_params: Vec<_> = config.parameters.iter().collect();
            sorted_params.sort_by(|a, b| b.highlight_range.byte_from.cmp(&a.highlight_range.byte_from));

            for param in sorted_params {
                let val = payload.unwrap_or(&param.highlight_range.original_text);
                modified = building_raw_request(&modified, val, &param.highlight_range);
            }
        }
        "zipped" | "combinatorial" => {
            let payload_list: Vec<String> = if let Some(p_str) = payload {
                if let Ok(list) = serde_json::from_str::<Vec<String>>(p_str) {
                    list
                } else {
                    p_str.split(", ").map(|s| s.to_string()).collect()
                }
            } else {
                Vec::new()
            };

            let mut sorted_params: Vec<_> = config.parameters.iter().enumerate().collect();
            sorted_params.sort_by(|a, b| b.1.highlight_range.byte_from.cmp(&a.1.highlight_range.byte_from));

            for (param_idx, param) in sorted_params {
                let default_val = &param.highlight_range.original_text;
                let val = payload_list.get(param_idx).map(|s| s.as_str()).unwrap_or(default_val);
                modified = building_raw_request(&modified, val, &param.highlight_range);
            }
        }
        _ => {
            if let Some(first_param) = config.parameters.first() {
                let val = payload.unwrap_or(&first_param.highlight_range.original_text);
                modified = building_raw_request(&modified, val, &first_param.highlight_range);
            }
        }
    }

    format_fuzz_request(&modified, keep_alive, update_cl)
}

fn get_parameter_target_count(p: &crate::types::FuzzerParameter) -> usize {
    if !p.values.is_empty() {
        p.values.len()
    } else if let Some(ref fc) = p.file_config {
        fc.line_count.unwrap_or(0)
    } else {
        0
    }
}

/// Calculates the total number of fuzzer target requests for a given configuration in O(1) time.
pub fn calculate_total_targets(config: &SessionPayload) -> usize {
    if config.parameters.is_empty() {
        return 0;
    }

    let attack_type = config
        .fuzzing_attack_type
        .as_deref()
        .unwrap_or("rotator")
        .to_lowercase();

    match attack_type.as_str() {
        "rotator" => {
            let num_vals = config.parameters.first().map(get_parameter_target_count).unwrap_or(0);
            config.parameters.len() * num_vals
        }
        "echo" => {
            config.parameters.first().map(get_parameter_target_count).unwrap_or(0)
        }
        "zipped" => {
            config.parameters.iter().map(get_parameter_target_count).min().unwrap_or(0)
        }
        "combinatorial" => {
            if config.parameters.iter().any(|p| get_parameter_target_count(p) == 0) {
                0
            } else {
                let mut total: usize = 1;
                for p in &config.parameters {
                    match total.checked_mul(get_parameter_target_count(p)) {
                        Some(t) => total = t,
                        None => return usize::MAX,
                    }
                }
                total
            }
        }
        _ => {
            config.parameters.first().map(get_parameter_target_count).unwrap_or(0)
        }
    }
}

/// Validates that any workspace files required by the fuzzer parameters exist and are not empty.
pub async fn validate_session_files(
    pool: &sqlx::SqlitePool,
    config: &SessionPayload,
) -> Result<(), String> {
    for param in &config.parameters {
        if param.payload_source == "file" {
            if let Some(ref fc) = param.file_config {
                let file_name = fc.file_name.as_deref().unwrap_or("unknown");
                match crate::ares_utils::database::files::get_project_file_lines(pool, &fc.file_id).await {
                    Ok(lines) if !lines.is_empty() => {},
                    Ok(_) => {
                        return Err(format!("Workspace file '{file_name}' is empty."));
                    }
                    Err(_) => {
                        return Err(format!(
                            "Workspace file '{file_name}' was not found in project database. Please re-import or reselect the file."
                        ));
                    }
                }
            } else {
                return Err("Parameter configured for file payload but no file was selected.".to_string());
            }
        }
    }
    Ok(())
}

/// Extracts the Location header value from an HTTP response, if present.
pub fn extract_location_header(raw_response: &str) -> Option<String> {
    for line in raw_response.lines() {
        let trimmed = line.trim_end_matches('\r');
        if trimmed.is_empty() {
            break;
        }
        let lower = trimmed.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("location:") {
            let val = &trimmed[trimmed.len() - rest.len()..];
            return Some(val.trim().to_string());
        }
    }
    None
}

/// Checks if two hostnames belong to the same site (exact host match or same base domain).
pub fn is_same_site(host_a: &str, host_b: &str) -> bool {
    let clean_a = host_a.split(':').next().unwrap_or(host_a).trim().to_lowercase();
    let clean_b = host_b.split(':').next().unwrap_or(host_b).trim().to_lowercase();
    if clean_a == clean_b {
        return true;
    }
    let parts_a: Vec<&str> = clean_a.split('.').collect();
    let parts_b: Vec<&str> = clean_b.split('.').collect();
    if parts_a.len() >= 2 && parts_b.len() >= 2 {
        let domain_a = format!("{}.{}", parts_a[parts_a.len() - 2], parts_a[parts_a.len() - 1]);
        let domain_b = format!("{}.{}", parts_b[parts_b.len() - 2], parts_b[parts_b.len() - 1]);
        return domain_a == domain_b;
    }
    false
}

/// Reconstructs an HTTP request targeting a new URL following a redirect.
/// Changes method to GET and strips body on 301, 302, 303.
/// Preserves method and body on 307, 308.
pub fn build_redirect_request(
    original_raw_req: &str,
    target_url_str: &str,
    status_code: u16,
) -> Option<String> {
    let parsed_url = url::Url::parse(target_url_str).ok()?;
    let host = parsed_url.host_str()?;
    let host_header_val = match parsed_url.port() {
        Some(p) => format!("{}:{}", host, p),
        None => host.to_string(),
    };
    let path_and_query = match parsed_url.query() {
        Some(q) => format!("{}?{}", parsed_url.path(), q),
        None => parsed_url.path().to_string(),
    };

    let (headers_part, body_part) = if let Some(pos) = original_raw_req.find("\r\n\r\n") {
        (&original_raw_req[..pos], &original_raw_req[pos + 4..])
    } else if let Some(pos) = original_raw_req.find("\n\n") {
        (&original_raw_req[..pos], &original_raw_req[pos + 2..])
    } else {
        (original_raw_req, "")
    };

    let line_delim = if original_raw_req.contains("\r\n") { "\r\n" } else { "\n" };
    let mut header_lines: Vec<String> = headers_part.lines().map(|s| s.trim_end_matches('\r').to_string()).collect();
    if header_lines.is_empty() {
        return None;
    }

    // 1. Determine new method & body
    let (new_method, new_body) = if status_code == 301 || status_code == 302 || status_code == 303 {
        ("GET".to_string(), "")
    } else {
        let original_method = header_lines[0].split_whitespace().next().unwrap_or("GET").to_string();
        (original_method, body_part)
    };

    // Update request line: METHOD path_and_query HTTP/1.1
    let http_version = header_lines[0].split_whitespace().nth(2).unwrap_or("HTTP/1.1").to_string();
    header_lines[0] = format!("{} {} {}", new_method, path_and_query, http_version);

    // 2. Update Host header
    let mut host_updated = false;
    for line in &mut header_lines {
        if line.to_ascii_lowercase().starts_with("host:") {
            *line = format!("Host: {}", host_header_val);
            host_updated = true;
            break;
        }
    }
    if !host_updated && header_lines.len() >= 1 {
        header_lines.insert(1, format!("Host: {}", host_header_val));
    }

    // 3. Update or remove Content-Length / Content-Type if switched to GET
    if new_method == "GET" && new_body.is_empty() {
        header_lines.retain(|l| {
            let lower = l.to_ascii_lowercase();
            !lower.starts_with("content-length:") && !lower.starts_with("content-type:")
        });
    } else {
        let body_len = new_body.as_bytes().len();
        let mut cl_found = false;
        for line in &mut header_lines {
            if line.to_ascii_lowercase().starts_with("content-length:") {
                *line = format!("Content-Length: {}", body_len);
                cl_found = true;
                break;
            }
        }
        if !cl_found && body_len > 0 {
            header_lines.push(format!("Content-Length: {}", body_len));
        }
    }

    let joined_headers = header_lines.join(line_delim);
    let double_delim = format!("{}{}", line_delim, line_delim);
    if new_body.is_empty() {
        Some(format!("{}{}", joined_headers, double_delim))
    } else {
        Some(format!("{}{}{}", joined_headers, double_delim, new_body))
    }
}

/// Generates the target id and payload string dynamically for a given sort_order index.
pub fn generate_payload_for_sort_order(
    config: &SessionPayload,
    sort_order: usize,
) -> (String, Option<String>) {
    if config.parameters.is_empty() {
        return (format!("{sort_order}"), None);
    }

    let attack_type = config
        .fuzzing_attack_type
        .as_deref()
        .unwrap_or("rotator")
        .to_lowercase();

    match attack_type.as_str() {
        "rotator" => {
            if let Some(first_param) = config.parameters.first() {
                let m = first_param.values.len();
                if m > 0 {
                    let param_idx = sort_order / m;
                    let val_idx = sort_order % m;
                    if let Some(param) = config.parameters.get(param_idx) {
                        let rules = crate::fuzzer::preprocessing::get_active_rules_for_config(config, param);
                        if let Some(raw_val) = first_param.values.get(val_idx) {
                            let transformed = crate::fuzzer::preprocessing::apply_pipeline(raw_val, rules);
                            return (format!("{param_idx}-{val_idx}"), Some(transformed));
                        }
                    }
                }
            }
            (format!("{sort_order}"), None)
        }
        "echo" => {
            if let Some(first_param) = config.parameters.first() {
                let rules = crate::fuzzer::preprocessing::get_active_rules_for_config(config, first_param);
                if let Some(val) = first_param.values.get(sort_order) {
                    let transformed = crate::fuzzer::preprocessing::apply_pipeline(val, rules);
                    return (format!("{sort_order}"), Some(transformed));
                }
            }
            (format!("{sort_order}"), None)
        }
        "zipped" => {
            let min_len = config.parameters.iter().map(|p| p.values.len()).min().unwrap_or(0);
            if sort_order >= min_len {
                return (format!("{sort_order}"), None);
            }
            let mut combo = Vec::with_capacity(config.parameters.len());
            for param in &config.parameters {
                let rules = crate::fuzzer::preprocessing::get_active_rules_for_config(config, param);
                let val = param.values.get(sort_order).map(|s| s.as_str()).unwrap_or("");
                combo.push(crate::fuzzer::preprocessing::apply_pipeline(val, rules));
            }
            (format!("{sort_order}"), serde_json::to_string(&combo).ok())
        }
        "combinatorial" => {
            let sizes: Vec<usize> = config.parameters.iter().map(|p| p.values.len()).collect();
            if sizes.is_empty() || sizes.iter().any(|&s| s == 0) {
                return (format!("{sort_order}"), None);
            }

            let mut rem = sort_order;
            let mut indices = vec![0; config.parameters.len()];
            for i in (0..config.parameters.len()).rev() {
                let s = sizes[i];
                indices[i] = rem % s;
                rem /= s;
            }

            let mut combo = Vec::with_capacity(config.parameters.len());
            for (p_idx, &val_idx) in indices.iter().enumerate() {
                let param = &config.parameters[p_idx];
                let rules = crate::fuzzer::preprocessing::get_active_rules_for_config(config, param);
                let val = param.values.get(val_idx).map(|s| s.as_str()).unwrap_or("");
                combo.push(crate::fuzzer::preprocessing::apply_pipeline(val, rules));
            }

            (format!("{sort_order}"), serde_json::to_string(&combo).ok())
        }
        _ => {
            if let Some(first_param) = config.parameters.first() {
                let rules = crate::fuzzer::preprocessing::get_active_rules_for_config(config, first_param);
                if let Some(val) = first_param.values.get(sort_order) {
                    let transformed = crate::fuzzer::preprocessing::apply_pipeline(val, rules);
                    return (format!("{sort_order}"), Some(transformed));
                }
            }
            (format!("{sort_order}"), None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{FuzzerParameter, PayloadMetadata};

    #[test]
    fn test_format_fuzz_request_content_length() {
        let raw = "POST /api HTTP/1.1\r\nHost: example.com\r\nContent-Length: 4\r\n\r\nhello_world";
        let formatted = format_fuzz_request(raw, false, true);
        assert!(formatted.contains("Content-Length: 11"));
        assert!(formatted.ends_with("\r\n\r\nhello_world"));
    }

    #[test]
    fn test_format_fuzz_request_keep_alive() {
        let raw = "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n";
        let formatted = format_fuzz_request(raw, true, false);
        assert!(formatted.contains("Connection: keep-alive"));
        assert!(!formatted.contains("Connection: close"));

        let raw_no_conn = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n";
        let formatted_added = format_fuzz_request(raw_no_conn, true, false);
        assert!(formatted_added.contains("Connection: keep-alive"));
    }

    #[test]
    fn test_format_fuzz_request_both() {
        let raw = "POST /submit HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\nContent-Length: 1\r\n\r\nusername=admin&password=123";
        let formatted = format_fuzz_request(raw, true, true);
        assert!(formatted.contains("Connection: keep-alive"));
        assert!(formatted.contains("Content-Length: 27"));
    }

    #[test]
    fn test_reconstruct_rotator_fuzzer_request() {
        let raw = "GET /user?id=123 HTTP/1.1\r\nHost: example.com\r\n\r\n";
        let from = 13; // byte index of '123'
        let to = 16;
        let config = SessionPayload {
            raw_request: raw.to_string(),
            parameters: vec![FuzzerParameter {
                payload_source: "manual".to_string(),
                values: vec!["999".to_string()],
                highlight_range: HighlightRange {
                    id: "param1".to_string(),
                    from: 13,
                    to: 16,
                    byte_from: from,
                    byte_to: to,
                    original_text: "123".to_string(),
                    is_active: true,
                },
                pipeline_rules: None,
                file_config: None,
            }],
            metadata: PayloadMetadata {
                target_url: "http://example.com".to_string(),
                url_is_valid: Some(true),
            },
            delay_ms: 0,
            fuzzing_attack_type: Some("rotator".to_string()),
            num_threads: Some(1),
            pipeline_scope: Some("all".to_string()),
            pipeline_rules: None,
            set_connection_keep_alive: Some(true),
            update_content_length: Some(true),
            ..Default::default()
        };

        let reconstructed = reconstruct_fuzzer_request(&config, Some("999"), "0-0");
        assert!(reconstructed.starts_with("GET /user?id=999 HTTP/1.1"));
        assert!(reconstructed.contains("Connection: keep-alive"));
    }

    #[test]
    fn test_reconstruct_combinatorial_fuzzer_request() {
        let raw = "POST /login HTTP/1.1\r\nHost: example.com\r\n\r\nuser=USER&pass=PASS";
        // byte range of USER: from 48 to 52
        // byte range of PASS: from 58 to 62
        let config = SessionPayload {
            raw_request: raw.to_string(),
            parameters: vec![
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["admin".to_string()],
                    highlight_range: HighlightRange {
                        id: "p1".to_string(),
                        from: 48,
                        to: 52,
                        byte_from: 48,
                        byte_to: 52,
                        original_text: "USER".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["secret123".to_string()],
                    highlight_range: HighlightRange {
                        id: "p2".to_string(),
                        from: 58,
                        to: 62,
                        byte_from: 58,
                        byte_to: 62,
                        original_text: "PASS".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
            ],
            metadata: PayloadMetadata {
                target_url: "http://example.com".to_string(),
                url_is_valid: Some(true),
            },
            delay_ms: 0,
            fuzzing_attack_type: Some("combinatorial".to_string()),
            num_threads: Some(1),
            pipeline_scope: Some("all".to_string()),
            pipeline_rules: None,
            set_connection_keep_alive: Some(true),
            update_content_length: Some(true),
            ..Default::default()
        };

        let json_payload = serde_json::to_string(&vec!["admin", "secret123"]).unwrap();
        let reconstructed = reconstruct_fuzzer_request(&config, Some(&json_payload), "0");
        assert!(reconstructed.contains("user=admin&pass=secret123"));
        assert!(reconstructed.contains("Content-Length: 25"));
        assert!(reconstructed.contains("Connection: keep-alive"));
    }

    #[test]
    fn test_generate_payload_for_sort_order_rotator() {
        let config = SessionPayload {
            raw_request: "GET /api?a=1&b=2 HTTP/1.1\r\nHost: example.com\r\n\r\n".to_string(),
            parameters: vec![
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["val1".to_string(), "val2".to_string()],
                    highlight_range: HighlightRange {
                        id: "p1".to_string(),
                        from: 11,
                        to: 12,
                        byte_from: 11,
                        byte_to: 12,
                        original_text: "1".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["val1".to_string(), "val2".to_string()],
                    highlight_range: HighlightRange {
                        id: "p2".to_string(),
                        from: 15,
                        to: 16,
                        byte_from: 15,
                        byte_to: 16,
                        original_text: "2".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
            ],
            metadata: PayloadMetadata {
                target_url: "http://example.com".to_string(),
                url_is_valid: Some(true),
            },
            delay_ms: 0,
            fuzzing_attack_type: Some("rotator".to_string()),
            num_threads: Some(1),
            pipeline_scope: Some("all".to_string()),
            pipeline_rules: None,
            set_connection_keep_alive: Some(true),
            update_content_length: Some(true),
            ..Default::default()
        };

        // Param 0, val 0 -> index 0
        let (id0, p0) = generate_payload_for_sort_order(&config, 0);
        assert_eq!(id0, "0-0");
        assert_eq!(p0, Some("val1".to_string()));

        // Param 0, val 1 -> index 1
        let (id1, p1) = generate_payload_for_sort_order(&config, 1);
        assert_eq!(id1, "0-1");
        assert_eq!(p1, Some("val2".to_string()));

        // Param 1, val 0 -> index 2
        let (id2, p2) = generate_payload_for_sort_order(&config, 2);
        assert_eq!(id2, "1-0");
        assert_eq!(p2, Some("val1".to_string()));

        // Param 1, val 1 -> index 3
        let (id3, p3) = generate_payload_for_sort_order(&config, 3);
        assert_eq!(id3, "1-1");
        assert_eq!(p3, Some("val2".to_string()));
    }

    #[test]
    fn test_generate_payload_for_sort_order_combinatorial() {
        let config = SessionPayload {
            raw_request: "GET /api?a=1&b=2 HTTP/1.1\r\nHost: example.com\r\n\r\n".to_string(),
            parameters: vec![
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["A".to_string(), "B".to_string()],
                    highlight_range: HighlightRange {
                        id: "p1".to_string(),
                        from: 11,
                        to: 12,
                        byte_from: 11,
                        byte_to: 12,
                        original_text: "1".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["1".to_string(), "2".to_string(), "3".to_string()],
                    highlight_range: HighlightRange {
                        id: "p2".to_string(),
                        from: 15,
                        to: 16,
                        byte_from: 15,
                        byte_to: 16,
                        original_text: "2".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
            ],
            metadata: PayloadMetadata {
                target_url: "http://example.com".to_string(),
                url_is_valid: Some(true),
            },
            delay_ms: 0,
            fuzzing_attack_type: Some("combinatorial".to_string()),
            num_threads: Some(1),
            pipeline_scope: Some("all".to_string()),
            pipeline_rules: None,
            set_connection_keep_alive: Some(true),
            update_content_length: Some(true),
            ..Default::default()
        };

        // Total 2 * 3 = 6 combos
        // Combo 0: A, 1
        let (id0, p0) = generate_payload_for_sort_order(&config, 0);
        assert_eq!(id0, "0");
        assert_eq!(p0, serde_json::to_string(&vec!["A", "1"]).ok());

        // Combo 1: A, 2
        let (id1, p1) = generate_payload_for_sort_order(&config, 1);
        assert_eq!(id1, "1");
        assert_eq!(p1, serde_json::to_string(&vec!["A", "2"]).ok());

        // Combo 3: B, 1
        let (id3, p3) = generate_payload_for_sort_order(&config, 3);
        assert_eq!(id3, "3");
        assert_eq!(p3, serde_json::to_string(&vec!["B", "1"]).ok());

        // Combo 5: B, 3
        let (id5, p5) = generate_payload_for_sort_order(&config, 5);
        assert_eq!(id5, "5");
        assert_eq!(p5, serde_json::to_string(&vec!["B", "3"]).ok());

        assert_eq!(calculate_total_targets(&config), 6);
    }

    #[test]
    fn test_calculate_total_and_zipped() {
        let mut config = SessionPayload {
            raw_request: "GET /api?a=1&b=2 HTTP/1.1\r\nHost: example.com\r\n\r\n".to_string(),
            parameters: vec![
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["A".to_string(), "B".to_string(), "C".to_string()],
                    highlight_range: HighlightRange {
                        id: "p1".to_string(),
                        from: 11,
                        to: 12,
                        byte_from: 11,
                        byte_to: 12,
                        original_text: "1".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
                FuzzerParameter {
                    payload_source: "manual".to_string(),
                    values: vec!["1".to_string(), "2".to_string()],
                    highlight_range: HighlightRange {
                        id: "p2".to_string(),
                        from: 15,
                        to: 16,
                        byte_from: 15,
                        byte_to: 16,
                        original_text: "2".to_string(),
                        is_active: true,
                    },
                    pipeline_rules: None,
                    file_config: None,
                },
            ],
            metadata: PayloadMetadata {
                target_url: "http://example.com".to_string(),
                url_is_valid: Some(true),
            },
            delay_ms: 0,
            fuzzing_attack_type: Some("zipped".to_string()),
            num_threads: Some(1),
            pipeline_scope: Some("all".to_string()),
            pipeline_rules: None,
            set_connection_keep_alive: Some(true),
            update_content_length: Some(true),
            ..Default::default()
        };

        // Zipped min length is min(3, 2) = 2
        assert_eq!(calculate_total_targets(&config), 2);

        let (z0_id, z0_payload) = generate_payload_for_sort_order(&config, 0);
        assert_eq!(z0_id, "0");
        assert_eq!(z0_payload, serde_json::to_string(&vec!["A", "1"]).ok());

        let (z1_id, z1_payload) = generate_payload_for_sort_order(&config, 1);
        assert_eq!(z1_id, "1");
        assert_eq!(z1_payload, serde_json::to_string(&vec!["B", "2"]).ok());

        // Test Rotator
        config.fuzzing_attack_type = Some("rotator".to_string());
        // 2 params * 3 values in first = 6
        assert_eq!(calculate_total_targets(&config), 6);

        // Test Echo
        config.fuzzing_attack_type = Some("echo".to_string());
        assert_eq!(calculate_total_targets(&config), 3);
    }

    #[test]
    fn test_extract_location_header() {
        let resp1 = "HTTP/1.1 302 Found\r\nLocation: /dashboard\r\nContent-Length: 0\r\n\r\n";
        assert_eq!(extract_location_header(resp1), Some("/dashboard".to_string()));

        let resp2 = "HTTP/1.1 301 Moved\nlocation: https://example.com/api\n\n";
        assert_eq!(extract_location_header(resp2), Some("https://example.com/api".to_string()));

        let resp3 = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n";
        assert_eq!(extract_location_header(resp3), None);
    }

    #[test]
    fn test_is_same_site() {
        assert!(is_same_site("example.com", "example.com"));
        assert!(is_same_site("example.com:8080", "example.com:443"));
        assert!(is_same_site("sub1.example.com", "sub2.example.com"));
        assert!(is_same_site("api.test.org", "test.org"));
        assert!(!is_same_site("example.com", "other.com"));
        assert!(!is_same_site("example.com", "example.org"));
    }

    #[test]
    fn test_build_redirect_request() {
        let original_post = "POST /login HTTP/1.1\r\nHost: auth.example.com\r\nContent-Length: 11\r\n\r\nuser=admin";
        
        // 302 switches to GET and removes body
        let req_302 = build_redirect_request(original_post, "https://app.example.com/dashboard?id=1", 302).unwrap();
        assert!(req_302.starts_with("GET /dashboard?id=1 HTTP/1.1\r\n"));
        assert!(req_302.contains("Host: app.example.com\r\n"));
        assert!(!req_302.contains("Content-Length:"));
        assert!(!req_302.contains("user=admin"));

        // 307 preserves POST and body
        let req_307 = build_redirect_request(original_post, "https://auth.example.com/v2/login", 307).unwrap();
        assert!(req_307.starts_with("POST /v2/login HTTP/1.1\r\n"));
        assert!(req_307.contains("Host: auth.example.com\r\n"));
        assert!(req_307.contains("Content-Length: 10\r\n"));
        assert!(req_307.ends_with("user=admin"));
    }
}
