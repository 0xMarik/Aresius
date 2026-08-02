//! Reassembling `Transfer-Encoding: chunked` bodies: incremental
//! completeness scanning during the read loop (`scan_chunked_body`) and
//! final reassembly into the plain payload (`dechunk`/`dechunk_or_fallback`).

use super::framing::find_subslice;
use anyhow::{anyhow, Result};

/// Incrementally scans a (possibly still-arriving) chunked body starting
/// from `cursor`, advancing `cursor` past every fully-received chunk.
/// Returns `Ok(Some(total_len))` once the terminating zero-size chunk and
/// its trailers have fully arrived, `Ok(None)` if more data is needed.
pub(super) fn scan_chunked_body(body: &[u8], cursor: &mut usize) -> Result<Option<usize>> {
    loop {
        if *cursor > body.len() {
            return Ok(None);
        }
        let remaining = &body[*cursor..];

        let line_end = match find_subslice(remaining, b"\r\n") {
            Some(i) => i,
            None => {
                if remaining.len() > 128 {
                    return Err(anyhow!("malformed or oversized chunk size line"));
                }
                return Ok(None);
            }
        };

        let size_line = &remaining[..line_end];
        let size_bytes = size_line.split(|&b| b == b';').next().unwrap_or(size_line);
        let size_str = std::str::from_utf8(size_bytes)
            .map_err(|_| anyhow!("invalid chunk size encoding"))?
            .trim();
        if size_str.is_empty() {
            return Err(anyhow!("empty chunk size line"));
        }
        let chunk_size = usize::from_str_radix(size_str, 16)
            .map_err(|_| anyhow!("invalid chunk size: {:?}", size_str))?;

        let after_size_line = *cursor + line_end + 2;

        if chunk_size == 0 {
            let trailer_region = &body[after_size_line..];
            if trailer_region.len() >= 2 && &trailer_region[..2] == b"\r\n" {
                return Ok(Some(after_size_line + 2));
            }
            if let Some(trailer_end) = find_subslice(trailer_region, b"\r\n\r\n") {
                return Ok(Some(after_size_line + trailer_end + 4));
            }
            return Ok(None);
        }

        let data_end = match after_size_line.checked_add(chunk_size) {
            Some(v) => v,
            None => return Err(anyhow!("chunk size overflow")),
        };
        let needed = data_end + 2;
        if body.len() < needed {
            return Ok(None);
        }
        if &body[data_end..needed] != b"\r\n" {
            return Err(anyhow!("malformed chunk terminator"));
        }

        *cursor = needed;
    }
}

/// Fully reassembles a complete chunked body into its plain payload.
/// Assumes `body` already contains the terminating zero-size chunk (i.e.
/// `scan_chunked_body` has confirmed completeness) -- use
/// `dechunk_or_fallback` when that isn't guaranteed.
fn dechunk(body: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(body.len());
    let mut pos = 0usize;

    loop {
        let remaining = body
            .get(pos..)
            .ok_or_else(|| anyhow!("chunk cursor past end of body"))?;
        let line_end = find_subslice(remaining, b"\r\n")
            .ok_or_else(|| anyhow!("truncated chunk size line"))?;

        let size_line = &remaining[..line_end];
        let size_bytes = size_line.split(|&b| b == b';').next().unwrap_or(size_line);
        let size_str = std::str::from_utf8(size_bytes)
            .map_err(|_| anyhow!("invalid chunk size encoding"))?
            .trim();
        let chunk_size = usize::from_str_radix(size_str, 16)
            .map_err(|_| anyhow!("invalid chunk size: {:?}", size_str))?;

        let data_start = pos + line_end + 2;
        if chunk_size == 0 {
            break;
        }

        let data_end = data_start
            .checked_add(chunk_size)
            .ok_or_else(|| anyhow!("chunk size overflow"))?;
        let data = body
            .get(data_start..data_end)
            .ok_or_else(|| anyhow!("chunk data runs past end of body"))?;
        out.extend_from_slice(data);

        pos = data_end + 2;
    }

    Ok(out)
}

/// Reassembles a complete chunked body, falling back to the raw bytes (with
/// a warning) if the connection dropped mid-stream before the terminating
/// chunk was fully framed -- callers get whatever payload arrived rather
/// than nothing.
pub(super) fn dechunk_or_fallback(raw_body: &[u8]) -> Vec<u8> {
    match dechunk(raw_body) {
        Ok(decoded) => decoded,
        Err(e) => {
            eprintln!(
                "warning: could not fully decode chunked body ({}), returning raw bytes",
                e
            );
            raw_body.to_vec()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dechunk_or_fallback_reassembles_complete_chunked_body() {
        let body = b"5\r\nhello\r\n0\r\n\r\n";
        assert_eq!(dechunk_or_fallback(body), b"hello".to_vec());
    }

    #[test]
    fn dechunk_or_fallback_returns_raw_bytes_on_malformed_input() {
        let truncated = b"5\r\nhel";
        assert_eq!(dechunk_or_fallback(truncated), truncated.to_vec());
    }

    #[test]
    fn scan_chunked_body_reports_incomplete_then_complete_across_calls() {
        let mut cursor = 0;
        let partial = b"5\r\nhel";
        assert_eq!(scan_chunked_body(partial, &mut cursor).unwrap(), None);

        let full = b"5\r\nhello\r\n0\r\n\r\n";
        assert_eq!(
            scan_chunked_body(full, &mut cursor).unwrap(),
            Some(full.len())
        );
    }
}