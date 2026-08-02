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
        return DecodedHttp {
            headers: headers.to_string(),
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
            headers: headers.to_string(),
            body,
        };
    }

    let mut current = body.clone();
    for coding in codings.iter().rev() {
        match decode_one(coding, &current, limits) {
            Ok(next) => current = next,
            Err(_) => {
                return DecodedHttp {
                    headers: headers.to_string(),
                    body,
                }
            } // give up, return original
        }
    }

    DecodedHttp {
        headers: rewrite_headers(headers, current.len()),
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
            let decompressor = brotli::Decompressor::new(input, 4096);
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
    let mut buf = [0u8; 8192];
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

/// Drops Content-Encoding and fixes up Content-Length to the decoded size.
fn rewrite_headers(original: &str, new_body_len: usize) -> String {
    original
        .split("\r\n")
        .enumerate()
        .filter_map(|(i, line)| {
            if i == 0 || line.is_empty() {
                return Some(line.to_string());
            }
            let (name, _) = line.split_once(':')?;
            match name.trim().to_ascii_lowercase().as_str() {
                "content-encoding" => None,
                "content-length" => Some(format!("Content-Length: {new_body_len}")),
                _ => Some(line.to_string()),
            }
        })
        .collect::<Vec<_>>()
        .join("\r\n")
}
