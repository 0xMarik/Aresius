use anyhow::{anyhow, Result};
use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use std::io::Read;

#[derive(Debug, Clone)]
pub struct DecodedHttp {
    pub headers: String,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct DecodeLimits {
    /// Refuse to even attempt decoding a body larger than this (compressed size on the wire).
    pub max_input_bytes: usize,
    /// Hard ceiling on decompressed output size.
    pub max_output_bytes: usize,
}

impl Default for DecodeLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 20 * 1024 * 1024,   // 20 MB compressed
            max_output_bytes: 100 * 1024 * 1024, // 100 MB decompressed
        }
    }
}

/// Undo Content-Encoding on a response body and scrub the header block to
/// match. Never panics/propagates on bad input -- a malformed or hostile
/// target just gets passed through as-is.
pub fn decode_response(headers: &str, body: Vec<u8>, limits: &DecodeLimits) -> DecodedHttp {
    let Some(raw_encodings) = find_header(headers, "content-encoding") else {
        // No Content-Encoding, but `body` is already fully buffered --
        // Transfer-Encoding is stale regardless.
        return DecodedHttp {
            headers: rewrite_headers(headers, body.len(), false),
            body,
        };
    };

    let codings: Vec<String> = raw_encodings
        .split(',')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty() && s != "identity")
        .collect();

    if codings.is_empty() {
        return DecodedHttp {
            headers: rewrite_headers(headers, body.len(), false),
            body,
        };
    }

    let mut current = body.clone();
    for coding in codings.iter().rev() {
        match decode_one(coding, &current, limits) {
            Ok(next) => current = next,
            Err(_) => {
                // Give up, pass through the still-encoded body -- keep
                // Content-Encoding (client needs it to decode), but
                // Transfer-Encoding is still stale and Content-Length
                // must match what we're actually sending (`body`).
                return DecodedHttp {
                    headers: rewrite_headers(headers, body.len(), false),
                    body,
                };
            }
        }
    }

    DecodedHttp {
        headers: rewrite_headers(headers, current.len(), true),
        body: current,
    }
}

fn decode_one(encoding: &str, input: &[u8], limits: &DecodeLimits) -> Result<Vec<u8>> {
    if input.len() > limits.max_input_bytes {
        return Err(anyhow!(
            "compressed body ({} bytes) exceeds max_input_bytes ({})",
            input.len(),
            limits.max_input_bytes
        ));
    }

    match encoding {
        "gzip" | "x-gzip" => bounded_read(GzDecoder::new(input), limits.max_output_bytes),
        "deflate" => bounded_read(ZlibDecoder::new(input), limits.max_output_bytes)
            .or_else(|_| bounded_read(DeflateDecoder::new(input), limits.max_output_bytes)),
        "br" => {
            let decompressor = brotli::Decompressor::new(input, 65536);
            bounded_read(decompressor, limits.max_output_bytes)
        }

        "zstd" => {
            let decoder = ruzstd::decoding::StreamingDecoder::new(input)
                .map_err(|e| anyhow!("zstd init failed: {e}"))?;
            bounded_read(decoder, limits.max_output_bytes)
        }
        other => Err(anyhow!("unsupported content-encoding: {other}")),
    }
}

/// Reads a decompression stream with a hard cap, so a small compressed
/// body can't be used to exhaust memory (zip-bomb style).
fn bounded_read<R: Read>(mut reader: R, max_output_bytes: usize) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        if out.len() > max_output_bytes {
            return Err(anyhow!("decoded body exceeded {max_output_bytes} bytes"));
        }
    }
    Ok(out)
}

/// Case-insensitive header lookup directly on the raw header block.
fn find_header<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    headers.split("\r\n").skip(1).find_map(|line| {
        let (k, v) = line.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

/// Fixes up Content-Length to `new_body_len` and always drops
/// Transfer-Encoding (the body is always fully buffered by the time it
/// reaches this module, so chunked framing is never valid going back out).
/// Content-Encoding is dropped only when `drop_content_encoding` is true --
/// if we're passing an undecoded body through, it has to stay.
pub fn rewrite_headers(original: &str, new_body_len: usize, drop_content_encoding: bool) -> String {
    let mut has_content_length = false;

    let mut lines: Vec<String> = original
        .lines()
        .enumerate()
        .filter_map(|(i, raw_line)| {
            let line = raw_line.trim_end_matches('\r');
            if line.is_empty() {
                return None;
            }
            if i == 0 {
                return Some(line.to_string());
            }
            let (name, _) = line.split_once(':')?;
            match name.trim().to_ascii_lowercase().as_str() {
                "content-encoding" if drop_content_encoding => None,
                "transfer-encoding" => None, // body is always fully buffered by now
                "content-length" => {
                    has_content_length = true;
                    Some(format!("Content-Length: {new_body_len}"))
                }
                _ => Some(line.to_string()),
            }
        })
        .collect();

    if !has_content_length {
        lines.push(format!("Content-Length: {new_body_len}"));
    }

    let mut result = lines.join("\r\n");
    result.push_str("\r\n\r\n");
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rewrite_headers_preserves_content_encoding_when_not_dropped() {
        let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip\r\n\r\n";
        let rewritten = rewrite_headers(headers, 1234, false);
        assert!(!rewritten.contains("Transfer-Encoding:"));
        assert!(rewritten.contains("Content-Encoding: gzip"));
        assert!(rewritten.contains("Content-Length: 1234"));
    }

    #[test]
    fn test_rewrite_headers_drops_content_encoding_when_requested() {
        let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip\r\n\r\n";
        let rewritten = rewrite_headers(headers, 5678, true);
        assert!(!rewritten.contains("Transfer-Encoding:"));
        assert!(!rewritten.contains("Content-Encoding:"));
        assert!(rewritten.contains("Content-Length: 5678"));
    }
}
