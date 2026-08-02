use std::io::Read;

use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};

/// Result of attempting to decode an HTTP body according to its `Content-Encoding` header.
#[derive(Debug, Clone)]
pub struct DecodedBody {
    /// Decoded bytes if `was_decoded` is true; otherwise identical to the original input.
    pub bytes: Vec<u8>,
    /// True if at least one content-coding was successfully removed.
    pub was_decoded: bool,
    /// Codings that were stripped, in the order they were removed (reverse of the header).
    pub codings_removed: Vec<String>,
    /// Set if decoding was attempted but aborted. `bytes` is the untouched original in this case.
    pub error: Option<String>,
}

/// Safety limits applied while decoding, primarily to guard against decompression bombs.
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

fn find_header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

/// Decodes an HTTP message body according to its `Content-Encoding` header, mirroring how
/// Burp Suite's proxy handles compressed bodies: attempt decompression for display/storage,
/// but never mutate or lose the original bytes if anything looks off.
///
/// # Scope
/// This only handles `Content-Encoding` (gzip/deflate/br/zstd). It assumes the body has
/// already been de-chunked — `Transfer-Encoding: chunked` is a wire-framing concern you
/// must resolve before calling this, not a content-coding.
///
/// # Behavior
/// - `Content-Encoding` may list multiple stacked codings (e.g. `gzip, br`), applied in
///   that order. Per RFC 9110 §8.4 they must be undone in reverse — last-applied first —
///   which is what this does.
/// - `identity` is a no-op and is skipped.
/// - `deflate` is handled leniently: RFC 2616 specifies zlib-wrapped DEFLATE, but plenty of
///   servers actually send raw DEFLATE for this coding. We try zlib-wrapped first and fall
///   back to raw deflate, the same ambiguity Burp's decompressor has to work around.
/// - `zstd` is decoded with `ruzstd`, a pure-Rust Zstandard implementation — no system
///   libzstd / C toolchain needed at build time, which matters for reproducible or
///   cross-compiled builds (e.g. static Kali/Parrot/Debian packaging). One caveat inherited
///   from `ruzstd::decoding::StreamingDecoder`: it only decodes a single zstd frame per
///   stream, whereas RFC 8878 technically allows multiple concatenated frames in one body.
///   That's fine for the overwhelming majority of real HTTP bodies; a body with concatenated
///   frames would surface as a decode error here (fail-soft) rather than silently truncating.
/// - Any unknown coding, or a failure at any stage (truncated stream, corrupted data, or a
///   server that mislabels its body — e.g. pre-encrypted-then-gzipped payloads) aborts the
///   whole operation and returns the ORIGINAL bytes untouched, with `error` set. Fail soft:
///   never return a partially-decoded or corrupted body.
/// - Decompressed output is bounded by `limits.max_output_bytes` to guard against
///   decompression-bomb DoS from a malicious or misbehaving target.
pub fn decode_http_body(
    headers: &[(String, String)],
    body: &[u8],
    limits: &DecodeLimits,
) -> DecodedBody {
    let pass_through = |err: Option<String>| DecodedBody {
        bytes: body.to_vec(),
        was_decoded: false,
        codings_removed: Vec::new(),
        error: err,
    };

    let Some(encoding_header) = find_header(headers, "content-encoding") else {
        return pass_through(None); // nothing to decode
    };

    if body.len() > limits.max_input_bytes {
        return pass_through(Some(format!(
            "body ({} bytes) exceeds max_input_bytes ({}); skipped decoding",
            body.len(),
            limits.max_input_bytes
        )));
    }

    // Codings are listed in the order they were APPLIED, so undo them in reverse.
    let codings: Vec<String> = encoding_header
        .split(',')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty() && s != "identity")
        .collect();

    if codings.is_empty() {
        return pass_through(None);
    }

    let mut current = body.to_vec();
    let mut removed = Vec::new();

    for coding in codings.iter().rev() {
        match decode_one(coding, &current, limits.max_output_bytes) {
            Ok(decoded) => {
                current = decoded;
                removed.push(coding.clone());
            }
            // Fail soft: return the ORIGINAL body, never a partially-decoded result.
            Err(e) => {
                return DecodedBody {
                    bytes: body.to_vec(),
                    was_decoded: false,
                    codings_removed: Vec::new(),
                    error: Some(format!(
                        "failed to decode '{coding}' (after stripping {removed:?}): {e}"
                    )),
                };
            }
        }
    }

    DecodedBody {
        bytes: current,
        was_decoded: true,
        codings_removed: removed,
        error: None,
    }
}

/// Decodes a single content-coding layer, bounded by `max_output_bytes`.
fn decode_one(coding: &str, input: &[u8], max_output_bytes: usize) -> std::io::Result<Vec<u8>> {
    match coding {
        "gzip" | "x-gzip" => read_bounded(GzDecoder::new(input), max_output_bytes),
        "deflate" => match read_bounded(ZlibDecoder::new(input), max_output_bytes) {
            Ok(out) => Ok(out),
            Err(_) => read_bounded(DeflateDecoder::new(input), max_output_bytes),
        },
        "br" => {
            let mut decompressor = brotli::Decompressor::new(input, 4096);
            read_bounded(&mut decompressor, max_output_bytes)
        }
        "zstd" => {
            // ruzstd::decoding::StreamingDecoder implements std::io::Read (with the
            // default "std" feature), so it drops straight into read_bounded exactly
            // like the other decoders above.
            let decoder = ruzstd::decoding::StreamingDecoder::new(input).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, format!("zstd: {e}"))
            })?;
            read_bounded(decoder, max_output_bytes)
        }
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unsupported content-coding: '{other}'"),
        )),
    }
}

/// Reads a decoder to completion, erroring out instead of allocating without bound if the
/// output exceeds `max_size`. This is the core defense against decompression-bomb payloads.
fn read_bounded<R: Read>(mut reader: R, max_size: usize) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        if out.len() + n > max_size {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!(
                    "decompressed output exceeded {max_size} byte limit — aborting \
                     (possible decompression bomb)"
                ),
            ));
        }
        out.extend_from_slice(&buf[..n]);
    }
    Ok(out)
}

/// Mirrors what Burp actually does when forwarding a decoded body to a client: strip
/// `Content-Encoding` (so the browser doesn't try to gunzip already-plain bytes) and fix
/// `Content-Length` to match the new body size.
///
/// Only apply this to the copy of headers you send OUTBOUND alongside `decoded.bytes`.
/// Keep the original raw headers + body untouched in history/storage — this is a derived,
/// forwarding-only transformation, not a mutation of the stored record.
pub fn headers_for_forwarding_decoded(
    headers: &[(String, String)],
    decoded: &DecodedBody,
) -> Vec<(String, String)> {
    if !decoded.was_decoded {
        return headers.to_vec();
    }

    headers
        .iter()
        .filter(|(k, _)| {
            !k.eq_ignore_ascii_case("content-encoding") && !k.eq_ignore_ascii_case("content-length")
        })
        .cloned()
        .chain(std::iter::once((
            "Content-Length".to_string(),
            decoded.bytes.len().to_string(),
        )))
        .collect()
}

/// Result of `decode_raw_response`: the full rewritten response bytes plus
/// the same decode outcome `decode_http_body` produced, so callers can tell
/// whether decoding actually happened without re-parsing headers themselves.
#[derive(Debug, Clone)]
pub struct DecodedRawResponse {
    /// Status line + rewritten headers + blank line + decoded body, ready
    /// to display or forward as-is.
    pub raw: Vec<u8>,
    pub decoded: DecodedBody,
}

/// Takes a raw HTTP message exactly as received off the wire -- status line,
/// headers, the blank-line separator, and the body, all in one buffer --
/// splits it, decodes the body per its `Content-Encoding`, and reassembles
/// a single raw response with the body decoded and the headers rewritten to
/// match (`Content-Encoding` stripped, `Content-Length` fixed up).
///
/// Takes `&[u8]` rather than `&str`: the header block is ASCII per spec (so
/// a lossy conversion there is harmless, same assumption `HttpResponse`
/// already makes), but the body frequently isn't valid UTF-8 -- images,
/// compressed bytes, arbitrary binary APIs -- and must not be run through a
/// lossy string conversion or it'll corrupt on the round trip.
///
/// If nothing needed decoding, or decoding failed, `raw` comes back
/// byte-identical to the input: `headers_for_forwarding_decoded` returns
/// the original headers untouched whenever `decoded.was_decoded` is false,
/// so nothing gets silently rewritten on a failed/skipped decode.
pub fn decode_raw_response(raw: &[u8], limits: &DecodeLimits) -> DecodedRawResponse {
    // No blank-line separator found (truncated/malformed response) --
    // treat the whole thing as headers with an empty body, same fallback
    // `HttpConnection::read_response` uses.
    let (header_block, body): (&[u8], &[u8]) = match raw.windows(4).position(|w| w == b"\r\n\r\n") {
        Some(pos) => (&raw[..pos], &raw[pos + 4..]),
        None => (raw, &[]),
    };

    let header_str = String::from_utf8_lossy(header_block);
    let mut lines = header_str.split("\r\n");
    let status_line = lines.next().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_string(), value.trim().to_string()))
        })
        .collect();

    let decoded = decode_http_body(&headers, body, limits);
    let forwarding_headers = headers_for_forwarding_decoded(&headers, &decoded);

    let mut out = Vec::with_capacity(
        status_line.len()
            + 2
            + forwarding_headers
                .iter()
                .map(|(k, v)| k.len() + v.len() + 4)
                .sum::<usize>()
            + 2
            + decoded.bytes.len(),
    );
    out.extend_from_slice(status_line.as_bytes());
    out.extend_from_slice(b"\r\n");
    for (name, value) in &forwarding_headers {
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(value.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(&decoded.bytes);

    DecodedRawResponse { raw: out, decoded }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(data).unwrap();
        enc.finish().unwrap()
    }

    /// Compresses with ruzstd's own encoder (`encoding::compress_to_vec`), mirroring the
    /// `gzip()` helper above — no extra dev-dependency needed just to build test fixtures.
    fn zstd_compress(data: &[u8]) -> Vec<u8> {
        ruzstd::encoding::compress_to_vec(data, ruzstd::encoding::CompressionLevel::Fastest)
    }

    #[test]
    fn decodes_gzip() {
        let original = b"hello aresius fuzzer";
        let compressed = gzip(original);
        let headers = vec![("Content-Encoding".to_string(), "gzip".to_string())];
        let result = decode_http_body(&headers, &compressed, &DecodeLimits::default());
        assert!(result.was_decoded);
        assert_eq!(result.bytes, original);
        assert_eq!(result.codings_removed, vec!["gzip"]);
    }

    #[test]
    fn decodes_zstd() {
        let original = b"hello aresius fuzzer, zstd edition";
        let compressed = zstd_compress(original);
        let headers = vec![("Content-Encoding".to_string(), "zstd".to_string())];
        let result = decode_http_body(&headers, &compressed, &DecodeLimits::default());
        assert!(result.was_decoded, "error: {:?}", result.error);
        assert_eq!(result.bytes, original);
        assert_eq!(result.codings_removed, vec!["zstd"]);
    }

    #[test]
    fn corrupted_zstd_fails_soft() {
        let garbage = b"not actually zstd data";
        let headers = vec![("content-encoding".to_string(), "zstd".to_string())];
        let result = decode_http_body(&headers, garbage, &DecodeLimits::default());
        assert!(!result.was_decoded);
        assert_eq!(result.bytes, garbage); // original preserved exactly
        assert!(result.error.is_some());
    }

    #[test]
    fn no_content_encoding_is_passthrough() {
        let body = b"plain text body";
        let result = decode_http_body(&[], body, &DecodeLimits::default());
        assert!(!result.was_decoded);
        assert_eq!(result.bytes, body);
        assert!(result.error.is_none());
    }

    #[test]
    fn corrupted_gzip_fails_soft() {
        let garbage = b"not actually gzip data";
        let headers = vec![("content-encoding".to_string(), "gzip".to_string())];
        let result = decode_http_body(&headers, garbage, &DecodeLimits::default());
        assert!(!result.was_decoded);
        assert_eq!(result.bytes, garbage); // original preserved exactly
        assert!(result.error.is_some());
    }

    #[test]
    fn decompression_bomb_guard_trips() {
        // 10MB of zeros compresses to almost nothing.
        let bomb_source = vec![0u8; 10 * 1024 * 1024];
        let compressed = gzip(&bomb_source);
        let headers = vec![("Content-Encoding".to_string(), "gzip".to_string())];
        let tiny_limits = DecodeLimits {
            max_input_bytes: 20 * 1024 * 1024,
            max_output_bytes: 1024, // 1KB cap, way under the 10MB payload
        };
        let result = decode_http_body(&headers, &compressed, &tiny_limits);
        assert!(!result.was_decoded);
        assert!(result.error.unwrap().contains("exceeded"));
        assert_eq!(result.bytes, compressed); // original preserved
    }

    #[test]
    fn header_parsing_trims_whitespace_and_case() {
        let original = b"stacked test";
        let compressed = gzip(original);
        let headers = vec![("Content-Encoding".to_string(), " GZIP ".to_string())];
        let result = decode_http_body(&headers, &compressed, &DecodeLimits::default());
        assert!(result.was_decoded);
        assert_eq!(result.bytes, original);
    }

    #[test]
    fn decode_raw_response_rewrites_headers_and_body() {
        let original = b"hello raw response world";
        let compressed = gzip(original);
        let mut raw = Vec::new();
        raw.extend_from_slice(b"HTTP/1.1 200 OK\r\n");
        raw.extend_from_slice(b"Content-Encoding: gzip\r\n");
        raw.extend_from_slice(format!("Content-Length: {}\r\n", compressed.len()).as_bytes());
        raw.extend_from_slice(b"Content-Type: text/plain\r\n");
        raw.extend_from_slice(b"\r\n");
        raw.extend_from_slice(&compressed);

        let result = decode_raw_response(&raw, &DecodeLimits::default());
        assert!(result.decoded.was_decoded);

        let rebuilt = String::from_utf8_lossy(&result.raw).to_string();
        assert!(rebuilt.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(!rebuilt.contains("Content-Encoding"));
        assert!(rebuilt.contains(&format!("Content-Length: {}", original.len())));
        assert!(result.raw.ends_with(original));
    }

    #[test]
    fn decode_raw_response_passthrough_when_undecoded() {
        let mut raw = Vec::new();
        raw.extend_from_slice(b"HTTP/1.1 200 OK\r\n");
        raw.extend_from_slice(b"Content-Type: text/plain\r\n");
        raw.extend_from_slice(b"\r\n");
        raw.extend_from_slice(b"plain body, nothing to decode");

        let result = decode_raw_response(&raw, &DecodeLimits::default());
        assert!(!result.decoded.was_decoded);
        assert_eq!(result.raw, raw); // byte-identical when nothing changes
    }

    #[test]
    fn forwarding_headers_strip_content_encoding() {
        let headers = vec![
            ("Content-Encoding".to_string(), "gzip".to_string()),
            ("Content-Length".to_string(), "1234".to_string()),
            ("Content-Type".to_string(), "application/json".to_string()),
        ];
        let decoded = DecodedBody {
            bytes: b"decoded body here".to_vec(),
            was_decoded: true,
            codings_removed: vec!["gzip".to_string()],
            error: None,
        };
        let out = headers_for_forwarding_decoded(&headers, &decoded);
        assert!(!out
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("content-encoding")));
        let cl = out
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
            .unwrap();
        assert_eq!(cl.1, decoded.bytes.len().to_string());
    }
}
