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

#[tauri::command]
pub async fn replay_request(
    url: String,
    request_tmp: String,
    req_id: Option<String>,
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
    let task = async move {
        let req = request_tmp;

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
    };

    let result = tokio::select! {
        res = task => res,
        _ = rx => Err("Request cancelled".to_string()),
    };

    if let Some(ref id) = req_id_clone {
        let mut map = REPLAYER_CANCELLERS.lock().await;
        map.remove(id);
    }

    result
}
