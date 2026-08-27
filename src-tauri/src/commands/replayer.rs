use std::collections::HashMap;
use std::sync::Arc;
use std::sync::LazyLock;
use std::time::Duration;

use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

use crate::ares_utils::http_connection::HttpConnection;
use crate::types::replayer::*;

static REPLAYER_CANCELLERS: LazyLock<Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

#[tauri::command]
pub async fn cancel_replayer_request(req_id: String) -> Result<(), String> {
    let mut map = REPLAYER_CANCELLERS.lock().await;
    if let Some(tx) = map.remove(&req_id) {
        let _ = tx.send(());
    }
    Ok(())
}

fn apply_force_close_connection(req: &str) -> String {
    let is_crlf = req.contains("\r\n");
    let newline = if is_crlf { "\r\n" } else { "\n" };

    if let Some(pos) = req.find("\r\n\r\n").or_else(|| req.find("\n\n")) {
        let sep_len = if req[pos..].starts_with("\r\n\r\n") { 4 } else { 2 };
        let header_block = &req[..pos];
        let body = &req[pos + sep_len..];

        let mut has_conn = false;
        let mut new_headers = Vec::new();

        for line in header_block.lines() {
            if let Some(colon_idx) = line.find(':') {
                let key = line[..colon_idx].trim().to_lowercase();
                if key == "connection" {
                    has_conn = true;
                    new_headers.push(format!("{}: close", line[..colon_idx].trim()));
                    continue;
                }
            }
            new_headers.push(line.to_string());
        }

        if !has_conn {
            new_headers.push("Connection: close".to_string());
        }

        format!("{}{}{}", new_headers.join(newline), &req[pos..pos + sep_len], body)
    } else {
        let mut has_conn = false;
        let mut new_headers = Vec::new();
        for line in req.lines() {
            if let Some(colon_idx) = line.find(':') {
                let key = line[..colon_idx].trim().to_lowercase();
                if key == "connection" {
                    has_conn = true;
                    new_headers.push(format!("{}: close", line[..colon_idx].trim()));
                    continue;
                }
            }
            new_headers.push(line.to_string());
        }
        if !has_conn && !req.trim().is_empty() {
            new_headers.push("Connection: close".to_string());
        }
        new_headers.join(newline)
    }
}

#[tauri::command]
pub async fn replay_request(
    url: String,
    request_tmp: String,
    req_id: Option<String>,
    force_close_connection: Option<bool>,
) -> Result<ReplayerResponse, String> {
    let (tx, rx) = oneshot::channel::<()>();

    if let Some(ref id) = req_id {
        let mut map = REPLAYER_CANCELLERS.lock().await;
        map.insert(id.clone(), tx);
    }

    let req_id_clone = req_id.clone();
    let target_url = if !url.contains("://") {
        format!("https://{}", url)
    } else {
        url
    };
    let task_url = target_url.clone();
    let force_close = force_close_connection.unwrap_or(false);

    let mut task = Box::pin(async move {
        let req = if force_close {
            apply_force_close_connection(&request_tmp)
        } else {
            request_tmp
        };

        let mut conn = HttpConnection::new(&task_url)
            .await
            .map_err(|e| format!("Connection failed: {e}"))?;

        let result = conn.send_request(&req.as_bytes()).await;

        match timeout(Duration::from_secs(5), conn.close()).await {
            Ok(Err(e)) => eprintln!("warning: failed to cleanly close connection to {task_url}: {e}"),
            Err(_) => eprintln!("warning: close on {task_url} timed out after 5s"),
            Ok(Ok(())) => {}
        }

        let response = result.map_err(|e| format!("Request failed: {e}"))?;

        Ok::<_, String>(ReplayerResponse {
            response_raw: response.as_text_lossy(),
            response_time: response.elapsed.as_millis(),
            request_raw: req,
            base_url: task_url,
        })
    });

    let result = tokio::select! {
        res = &mut task => res,
        _ = rx => Err("Request cancelled".to_string()),
    };

    if let Some(ref id) = req_id_clone {
        let mut map = REPLAYER_CANCELLERS.lock().await;
        map.remove(id);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_replay_request_future_size() {
        let fut = replay_request("example.com".into(), "GET / HTTP/1.1\r\n\r\n".into(), None, None);
        println!("replay_request future size: {} bytes", std::mem::size_of_val(&fut));
        assert!(std::mem::size_of_val(&fut) < 16384, "Future size is too large: {} bytes", std::mem::size_of_val(&fut));
    }
}
