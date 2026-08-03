//! Deciding how an HTTP response is framed: locating the header/body
//! boundary, reading RFC 7230 §3.3.3 body-presence rules off the status
//! line/headers, and tracking when a body of a given framing is complete.

use anyhow::{anyhow, Result};

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

#[derive(Debug)]
pub(super) struct RequestFraming {
    // pub(super) connection_close: bool,
    pub(super) body_framing: BodyFraming,
}

/// Same header rules as `parse_response_framing`, minus the status-code /
/// HEAD bodyless check (not applicable to requests) and minus the
/// `UntilClose` fallback (RFC 7230 §3.3.3 rule 6: a request with neither
/// header always means no body -- never "read until close").
pub(super) fn parse_request_framing(header_block: &str) -> Result<RequestFraming> {
    // let mut connection_close = false;
    let mut is_chunked = false;
    let mut content_length: Option<usize> = None;

    for line in header_block.lines() {
        let line_lower = line.to_lowercase();
        // if let Some(value) = line_lower.strip_prefix("connection:") {
        //     if value.contains("close") {
        //         connection_close = true;
        //     }
        // } else
        if let Some(value) = line_lower.strip_prefix("transfer-encoding:") {
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

    // Same smuggling-avoidance rule as the response side: chunked wins.
    let body_framing = if is_chunked {
        BodyFraming::Chunked
    } else if let Some(len) = content_length {
        BodyFraming::ContentLength(len)
    } else {
        BodyFraming::NoBody
    };

    Ok(RequestFraming {
        // connection_close,
        body_framing,
    })
}
