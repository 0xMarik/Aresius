use crate::ares_utils::parse::split_message;

/// Extracts the raw Content-Type header value (lowercase trimmed MIME type without parameters)
pub fn extract_content_type(headers: &str) -> Option<String> {
    for line in headers.lines() {
        let trimmed = line.trim();
        if trimmed.len() > 13 && trimmed[..13].eq_ignore_ascii_case("content-type:") {
            let val = trimmed[13..].trim();
            // Take the MIME type part before ';' parameter if present
            let mime = val.split(';').next().unwrap_or("").trim().to_lowercase();
            if !mime.is_empty() {
                return Some(mime);
            }
        }
    }
    None
}

/// Determines whether a MIME type represents text-based data (HTML, JSON, XML, scripts, styles, plain text, etc.)
pub fn is_text_based_mime(mime: &str) -> bool {
    let m = mime.trim().to_lowercase();

    // 1. Any text/* MIME type
    if m.starts_with("text/") {
        return true;
    }

    // 2. Structured text subtypes: *+json, *+xml, *+yaml
    if m.ends_with("+json") || m.ends_with("+xml") || m.ends_with("+yaml") {
        return true;
    }

    // 3. Known text application formats
    match m.as_str() {
        "application/json"
        | "application/xml"
        | "application/javascript"
        | "application/x-javascript"
        | "application/x-www-form-urlencoded"
        | "application/graphql"
        | "application/graphql-response+json"
        | "application/yaml"
        | "application/x-yaml"
        | "application/toml"
        | "application/sql"
        | "application/x-sql"
        | "application/csp-report"
        | "application/jwt"
        | "application/x-ndjson"
        | "application/x-pem-file"
        | "application/x-x509-ca-cert"
        | "image/svg+xml" => true,

        // Explicit binary formats
        _ if m.starts_with("image/")
            || m.starts_with("audio/")
            || m.starts_with("video/")
            || m.starts_with("font/") =>
        {
            false
        }

        _ if m.contains("zip")
            || m.contains("tar")
            || m.contains("gzip")
            || m.contains("pdf")
            || m.contains("wasm")
            || m.contains("octet-stream") =>
        {
            false
        }

        _ => false,
    }
}

/// Fallback heuristic for responses missing Content-Type or using generic types:
/// Checks if the first 512 bytes contain no binary null bytes and consist of printable characters.
pub fn is_text_based_body_heuristic(body: &str) -> bool {
    let check_slice = if body.len() > 512 {
        &body[..512]
    } else {
        body
    };

    if check_slice.is_empty() {
        return false;
    }

    // Binary null byte presence is a definitive indicator of non-text data
    if check_slice.contains('\0') {
        return false;
    }

    // Check ratio of printable/whitespace characters
    let mut printable_count = 0usize;
    let mut total_chars = 0usize;

    for ch in check_slice.chars() {
        total_chars += 1;
        if !ch.is_control() || ch == '\r' || ch == '\n' || ch == '\t' {
            printable_count += 1;
        }
    }

    if total_chars == 0 {
        return false;
    }

    // If at least 95% of characters are printable text/whitespace, consider it text
    (printable_count as f64 / total_chars as f64) >= 0.95
}

/// Checks whether an entire raw HTTP response is text-based (safe to index in FTS)
pub fn is_text_based_response(raw_response: &str) -> bool {
    if raw_response.is_empty() {
        return false;
    }

    let (headers, body) = split_message(raw_response);

    if let Some(mime) = extract_content_type(headers) {
        if is_text_based_mime(&mime) {
            return true;
        }
        // Explicit non-text MIME (e.g. image/png, video/mp4, application/pdf)
        if mime.starts_with("image/")
            || mime.starts_with("audio/")
            || mime.starts_with("video/")
            || mime.starts_with("font/")
            || mime == "application/pdf"
            || mime == "application/zip"
            || mime == "application/gzip"
            || mime == "application/wasm"
        {
            return false;
        }

        // If generic octet-stream, check fallback heuristic
        if mime == "application/octet-stream" {
            return is_text_based_body_heuristic(body);
        }

        return false;
    }

    // No Content-Type header: use text heuristic on the body
    is_text_based_body_heuristic(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_text_mime_types() {
        assert!(is_text_based_mime("text/html"));
        assert!(is_text_based_mime("text/plain"));
        assert!(is_text_based_mime("text/css"));
        assert!(is_text_based_mime("text/csv"));
        assert!(is_text_based_mime("text/javascript"));
        assert!(is_text_based_mime("application/json"));
        assert!(is_text_based_mime("application/problem+json"));
        assert!(is_text_based_mime("application/ld+json"));
        assert!(is_text_based_mime("application/xml"));
        assert!(is_text_based_mime("application/atom+xml"));
        assert!(is_text_based_mime("image/svg+xml"));
        assert!(is_text_based_mime("application/graphql"));
        assert!(is_text_based_mime("application/yaml"));
    }

    #[test]
    fn test_binary_mime_types() {
        assert!(!is_text_based_mime("image/png"));
        assert!(!is_text_based_mime("image/jpeg"));
        assert!(!is_text_based_mime("image/gif"));
        assert!(!is_text_based_mime("image/webp"));
        assert!(!is_text_based_mime("audio/mpeg"));
        assert!(!is_text_based_mime("video/mp4"));
        assert!(!is_text_based_mime("application/pdf"));
        assert!(!is_text_based_mime("application/zip"));
        assert!(!is_text_based_mime("application/gzip"));
        assert!(!is_text_based_mime("application/wasm"));
        assert!(!is_text_based_mime("font/woff2"));
    }

    #[test]
    fn test_is_text_based_response_json() {
        let resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{\"status\":\"ok\"}";
        assert!(is_text_based_response(resp));
    }

    #[test]
    fn test_is_text_based_response_image() {
        let resp = "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\n\u{0089}PNG\r\n\x1a\n\x00\x00\x00\rIHDR";
        assert!(!is_text_based_response(resp));
    }

    #[test]
    fn test_is_text_based_response_missing_content_type_with_text_error() {
        let resp = "HTTP/1.1 500 Internal Error\r\nServer: Custom\r\n\r\nDatabase Error: syntax error near 'admin'";
        assert!(is_text_based_response(resp));
    }

    #[test]
    fn test_is_text_based_response_missing_content_type_with_binary() {
        let resp = "HTTP/1.1 200 OK\r\nServer: Custom\r\n\r\n\x00\x01\x02\x03\x00\x05binarypayload";
        assert!(!is_text_based_response(resp));
    }
}
