use crate::types::HighlightRange;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
