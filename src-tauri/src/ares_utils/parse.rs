/// Splits a headers+body HTTP message text on the blank line separating
/// them. Same split `resync_edited_message` does on the request/response
/// text -- factored out here so history parsing and resync agree on where
/// "body" starts instead of drifting if one gets tweaked later.
pub fn split_message(message: &str) -> (&str, &str) {
    message
        .split_once("\r\n\r\n")
        .or_else(|| message.split_once("\n\n"))
        .unwrap_or((message, ""))
}

pub fn parse_status_code(response_head: &str) -> u16 {
    response_head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or(0)
}

pub struct RequestLineMeta {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub extension: Option<String>,
}

/// Parses method/path/query/extension from the byte-exact request that was
/// actually sent (post-intercept-edit if any). Only reads the request
/// line -- ignores anything after it, so a POST body trailing the headers
/// doesn't matter here.
pub fn parse_request_line(outgoing_request_bytes: &[u8]) -> RequestLineMeta {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut req = httparse::Request::new(&mut headers);

    let (method, raw_target) = match req.parse(outgoing_request_bytes) {
        Ok(_) => (
            req.method.unwrap_or("").to_string(),
            req.path.unwrap_or("").to_string(),
        ),
        Err(_) => (String::new(), String::new()),
    };

    // Forward-proxy plain HTTP can use absolute-form: "GET http://host/api HTTP/1.1".
    // Strip scheme+authority so `path` doesn't end up containing the host.
    let target = raw_target
        .strip_prefix("http://")
        .or_else(|| raw_target.strip_prefix("https://"))
        .map(|rest| rest.find('/').map(|i| &rest[i..]).unwrap_or("/"))
        .unwrap_or(&raw_target);

    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (target.to_string(), None),
    };

    let extension = path
        .rsplit('/')
        .next()
        .and_then(|seg| seg.rfind('.').map(|i| seg[i + 1..].to_string()))
        .filter(|ext| !ext.is_empty() && ext.len() <= 10)
        .map(|ext| ext.to_lowercase());

    RequestLineMeta {
        method,
        path,
        query,
        extension,
    }
}
