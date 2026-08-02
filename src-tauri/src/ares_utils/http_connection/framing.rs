//! Deciding how an HTTP response is framed: locating the header/body
//! boundary, reading RFC 7230 §3.3.3 body-presence rules off the status
//! line/headers, and tracking when a body of a given framing is complete.

use anyhow::{anyhow, Result};

/// True if `http_request`'s request line starts with the HEAD method.
/// A HEAD response, per RFC 7230 §3.3.3, never carries a body no matter
/// what Content-Length/Transfer-Encoding say.
pub(super) fn is_head_method(http_request: &str) -> bool {
    http_request
        .split_whitespace()
        .next()
        .map(|method| method.eq_ignore_ascii_case("HEAD"))
        .unwrap_or(false)
}

/// Incrementally looks for the header/body separator (`"\r\n\r\n"`) in
/// `buffer`. Only scans the region from `scan_from` onward (with a small
/// overlap in case the separator straddled a read boundary) rather than
/// re-scanning the whole buffer on every call, then advances `scan_from`
/// so the next call resumes from where this one left off.
///
/// Returns the byte offset where the separator begins, or `None` if it
/// hasn't arrived yet.
pub(super) fn locate_header_terminator(buffer: &[u8], scan_from: &mut usize) -> Option<usize> {
    let scan_start = scan_from.saturating_sub(3);
    match find_subslice(&buffer[scan_start..], b"\r\n\r\n") {
        Some(rel_pos) => Some(scan_start + rel_pos),
        None => {
            *scan_from = buffer.len();
            None
        }
    }
}

/// Extracts the numeric status code from a response's status line (the
/// first line of `header_block`), e.g. `204` from `"HTTP/1.1 204 No
/// Content"`.
fn parse_status_code(header_block: &str) -> Option<u16> {
    header_block
        .lines()
        .next()
        .and_then(|status_line| status_line.split_whitespace().nth(1))
        .and_then(|code_str| code_str.parse().ok())
}

/// RFC 7230 §3.3.3: 1xx, 204, and 304 responses are always bodyless,
/// regardless of any Content-Length/Transfer-Encoding header they carry.
fn is_no_body_status(status_code: Option<u16>) -> bool {
    matches!(status_code, Some(100..=199) | Some(204) | Some(304))
}

/// How the response body is delimited, per RFC 7230 §3.3.3. Exactly one of
/// these applies to any given response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BodyFraming {
    /// No body follows the headers, regardless of what Content-Length or
    /// Transfer-Encoding claim (HEAD request, or a 1xx/204/304 status).
    NoBody,
    /// `Transfer-Encoding: chunked`.
    Chunked,
    /// A single, non-conflicting `Content-Length` value.
    ContentLength(usize),
    /// Neither header present -- the body runs until the connection
    /// closes (HTTP/1.0-style framing).
    UntilClose,
}

/// Everything `read_response` needs from the status line and headers: how
/// the connection should be treated afterwards, and how the body is framed.
#[derive(Debug)]
pub(super) struct ResponseFraming {
    /// `Connection: close` was present -- the socket should be treated as
    /// unusable for a next request even if this read completes cleanly.
    pub(super) connection_close: bool,
    pub(super) body_framing: BodyFraming,
}

/// Parses the status line + header block (everything before the blank line,
/// as located by `locate_header_terminator`) into a `ResponseFraming`. This
/// is where the RFC 7230 §3.3.3 body-framing rules -- and the
/// smuggling-relevant edge case of conflicting/duplicated Content-Length --
/// are decided.
pub(super) fn parse_response_framing(
    header_block: &str,
    is_head_request: bool,
) -> Result<ResponseFraming> {
    let mut connection_close = false;
    let mut is_chunked = false;
    let mut content_length: Option<usize> = None;

    for line in header_block.lines() {
        let line_lower = line.to_lowercase();
        if let Some(value) = line_lower.strip_prefix("connection:") {
            if value.contains("close") {
                connection_close = true;
            }
        } else if let Some(value) = line_lower.strip_prefix("transfer-encoding:") {
            if value.contains("chunked") {
                is_chunked = true;
            }
        } else if let Some(value) = line_lower.strip_prefix("content-length:") {
            let parsed: usize = value
                .trim()
                .parse()
                .map_err(|_| anyhow!("invalid Content-Length header"))?;
            if let Some(existing) = content_length {
                if existing != parsed {
                    // Conflicting Content-Length values are a classic
                    // request/response-smuggling smell -- refuse to
                    // silently pick one.
                    return Err(anyhow!(
                        "conflicting Content-Length headers ({} vs {})",
                        existing,
                        parsed
                    ));
                }
            }
            content_length = Some(parsed);
        }
    }

    let no_body = is_head_request || is_no_body_status(parse_status_code(header_block));

    if !no_body && is_chunked && content_length.is_some() {
        // RFC 7230 §3.3.3: a message with both is smuggling-ambiguous;
        // Transfer-Encoding wins, but flag it rather than parse silently.
        eprintln!(
            "warning: response has both Content-Length and chunked \
             Transfer-Encoding; treating as chunked"
        );
        content_length = None;
    }

    let body_framing = if no_body {
        BodyFraming::NoBody
    } else if is_chunked {
        BodyFraming::Chunked
    } else if let Some(len) = content_length {
        BodyFraming::ContentLength(len)
    } else {
        BodyFraming::UntilClose
    };

    Ok(ResponseFraming {
        connection_close,
        body_framing,
    })
}

/// Checks whether `buffer` (everything read from the socket so far)
/// contains a complete body per `framing`, given the body starts at
/// `header_end`. `chunk_cursor` carries incremental chunked-parsing
/// progress across calls -- see `chunked::scan_chunked_body`.
///
/// Returns `Ok(Some(total_len))` once the response is fully framed, where
/// `total_len` is the length `buffer` should be truncated to (dropping any
/// bytes belonging to a subsequent, pipelined response). Returns
/// `Ok(None)` if more data is still needed.
pub(super) fn body_is_complete(
    buffer: &[u8],
    header_end: usize,
    framing: BodyFraming,
    chunk_cursor: &mut usize,
) -> Result<Option<usize>> {
    match framing {
        BodyFraming::NoBody => Ok(Some(header_end)),
        BodyFraming::Chunked => {
            let body = &buffer[header_end..];
            Ok(super::chunked::scan_chunked_body(body, chunk_cursor)?.map(|len| header_end + len))
        }
        BodyFraming::ContentLength(expected) => {
            let body_len = buffer.len() - header_end;
            Ok((body_len >= expected).then_some(header_end + expected))
        }
        BodyFraming::UntilClose => Ok(None),
    }
}

/// Byte-substring search shared by header/body framing and chunk parsing.
pub(super) fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn head_method_is_case_insensitive_and_ignores_other_verbs() {
        assert!(is_head_method("HEAD /foo HTTP/1.1"));
        assert!(is_head_method("head /foo HTTP/1.1"));
        assert!(!is_head_method("GET /foo HTTP/1.1"));
        assert!(!is_head_method(""));
    }

    #[test]
    fn locate_header_terminator_finds_separator_and_advances_scan_from() {
        let mut scan_from = 0;
        let buf = b"HTTP/1.1 200 OK\r\nA: b\r\n\r\nbody";
        let pos = locate_header_terminator(buf, &mut scan_from);
        assert_eq!(pos, Some(21));
    }

    #[test]
    fn locate_header_terminator_returns_none_and_records_progress_when_absent() {
        let mut scan_from = 0;
        let buf = b"HTTP/1.1 200 OK\r\nA: b\r\n";
        let pos = locate_header_terminator(buf, &mut scan_from);
        assert_eq!(pos, None);
        assert_eq!(scan_from, buf.len());
    }

    #[test]
    fn locate_header_terminator_finds_separator_split_across_two_reads() {
        // First read ends mid-separator ("\r\n\r"), second brings the "\n".
        let mut scan_from = 0;
        let first = b"HTTP/1.1 200 OK\r\n\r";
        assert_eq!(locate_header_terminator(first, &mut scan_from), None);
        assert_eq!(scan_from, first.len());

        let mut full = first.to_vec();
        full.push(b'\n');
        let pos = locate_header_terminator(&full, &mut scan_from);
        // "HTTP/1.1 200 OK" is 15 bytes, so the separator starts at index 15.
        assert_eq!(pos, Some(15));
    }

    #[test]
    fn status_code_parses_from_status_line() {
        assert_eq!(
            parse_status_code("HTTP/1.1 204 No Content\r\nA: b"),
            Some(204)
        );
        assert_eq!(parse_status_code("garbage"), None);
        assert_eq!(parse_status_code(""), None);
    }

    #[test]
    fn no_body_status_matches_1xx_204_and_304_only() {
        assert!(is_no_body_status(Some(100)));
        assert!(is_no_body_status(Some(199)));
        assert!(is_no_body_status(Some(204)));
        assert!(is_no_body_status(Some(304)));
        assert!(!is_no_body_status(Some(200)));
        assert!(!is_no_body_status(Some(404)));
        assert!(!is_no_body_status(None));
    }

    #[test]
    fn framing_picks_content_length_when_present_alone() {
        let framing =
            parse_response_framing("HTTP/1.1 200 OK\r\nContent-Length: 42", false).unwrap();
        assert!(!framing.connection_close);
        assert_eq!(framing.body_framing, BodyFraming::ContentLength(42));
    }

    #[test]
    fn framing_picks_chunked_when_present_alone() {
        let framing =
            parse_response_framing("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked", false).unwrap();
        assert_eq!(framing.body_framing, BodyFraming::Chunked);
    }

    #[test]
    fn framing_prefers_chunked_over_content_length_when_both_present() {
        let framing = parse_response_framing(
            "HTTP/1.1 200 OK\r\nContent-Length: 42\r\nTransfer-Encoding: chunked",
            false,
        )
        .unwrap();
        assert_eq!(framing.body_framing, BodyFraming::Chunked);
    }

    #[test]
    fn framing_is_no_body_for_head_request_even_with_content_length() {
        let framing =
            parse_response_framing("HTTP/1.1 200 OK\r\nContent-Length: 9999", true).unwrap();
        assert_eq!(framing.body_framing, BodyFraming::NoBody);
    }

    #[test]
    fn framing_is_no_body_for_204_and_304_even_with_content_length() {
        for status in ["204 No Content", "304 Not Modified"] {
            let header_block = format!("HTTP/1.1 {status}\r\nContent-Length: 123");
            let framing = parse_response_framing(&header_block, false).unwrap();
            assert_eq!(
                framing.body_framing,
                BodyFraming::NoBody,
                "status: {status}"
            );
        }
    }

    #[test]
    fn framing_falls_back_to_until_close_with_no_framing_headers() {
        let framing = parse_response_framing("HTTP/1.1 200 OK\r\nX-Foo: bar", false).unwrap();
        assert_eq!(framing.body_framing, BodyFraming::UntilClose);
    }

    #[test]
    fn framing_detects_connection_close() {
        let framing = parse_response_framing(
            "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0",
            false,
        )
        .unwrap();
        assert!(framing.connection_close);
    }

    #[test]
    fn framing_rejects_conflicting_content_length() {
        let err = parse_response_framing(
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 6",
            false,
        )
        .unwrap_err();
        assert!(err.to_string().contains("conflicting"));
    }

    #[test]
    fn framing_allows_duplicate_identical_content_length() {
        let framing = parse_response_framing(
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 5",
            false,
        )
        .unwrap();
        assert_eq!(framing.body_framing, BodyFraming::ContentLength(5));
    }

    #[test]
    fn body_complete_no_body_is_immediate() {
        let buf = b"headers-of-len-11body-follows";
        let mut cursor = 0;
        let result = body_is_complete(buf, 11, BodyFraming::NoBody, &mut cursor).unwrap();
        assert_eq!(result, Some(11));
    }

    #[test]
    fn body_complete_content_length_waits_for_enough_bytes() {
        let mut cursor = 0;
        let partial = b"HDRbody";
        assert_eq!(
            body_is_complete(partial, 3, BodyFraming::ContentLength(10), &mut cursor).unwrap(),
            None
        );

        let full = b"HDR0123456789";
        assert_eq!(
            body_is_complete(full, 3, BodyFraming::ContentLength(10), &mut cursor).unwrap(),
            Some(13)
        );
    }

    #[test]
    fn body_complete_until_close_never_completes_on_its_own() {
        let mut cursor = 0;
        let buf = b"HDRanything at all";
        assert_eq!(
            body_is_complete(buf, 3, BodyFraming::UntilClose, &mut cursor).unwrap(),
            None
        );
    }

    #[test]
    fn body_complete_chunked_delegates_to_scan_chunked_body() {
        let mut cursor = 0;
        // "5\r\nhello\r\n0\r\n\r\n" -- one 5-byte chunk, then the terminator.
        let buf = b"HDR5\r\nhello\r\n0\r\n\r\n";
        let result = body_is_complete(buf, 3, BodyFraming::Chunked, &mut cursor).unwrap();
        assert_eq!(result, Some(buf.len()));
    }

    #[test]
    fn find_subslice_basic_cases() {
        assert_eq!(find_subslice(b"abcde", b"cd"), Some(2));
        assert_eq!(find_subslice(b"abcde", b"zz"), None);
        assert_eq!(find_subslice(b"abc", b""), None);
        assert_eq!(find_subslice(b"ab", b"abc"), None);
    }
}
