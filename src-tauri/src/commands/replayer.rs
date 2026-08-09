use std::time::Duration;

use tokio::time::timeout;

use crate::ares_utils::http_connection::HttpConnection;
use crate::types::replayer::*;

#[tauri::command]
pub async fn replay_request(url: String, request_tmp: String) -> Result<ReplayerResponse, String> {
    let req = request_tmp;

    let mut conn = HttpConnection::new(&url)
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    let result = conn.send_request(&req.as_bytes()).await;

    // Always attempt a clean shutdown, whether or not the request
    // succeeded. A target that's slow or hostile shouldn't be able to make
    // this hang forever, so bound it with a short timeout; either way we
    // don't let a close failure override a response we already have.
    match timeout(Duration::from_secs(5), conn.close()).await {
        Ok(Err(e)) => eprintln!("warning: failed to cleanly close connection to {url}: {e}"),
        Err(_) => eprintln!("warning: close on {url} timed out after 5s"),
        Ok(Ok(())) => {}
    }

    let response = result.map_err(|e| format!("Request failed: {e}"))?;

    Ok(ReplayerResponse {
        response_raw: response.as_text_lossy(),
        response_time: response.elapsed.as_millis(),
        request_raw: req,
        base_url: url.clone(),
    })
}
