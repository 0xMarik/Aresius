use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WsStreamRow {
    pub id: i64,
    pub project_id: String,
    pub destination: String,
    pub path: String,
    pub is_tls: bool,
    pub created_at: i64,
    pub closed_at: Option<i64>,
    pub status: String,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WsMessageRow {
    pub id: i64,
    pub stream_id: i64,
    pub project_id: String,
    pub direction: String,
    pub message_type: String,
    pub payload: String,
    pub payload_length: i64,
    pub sent_at: i64,
}

/// Inserts a new WebSocket stream into the database and returns its row ID.
pub async fn save_ws_stream(
    pool: &SqlitePool,
    project_id: &str,
    destination: &str,
    path: &str,
    is_tls: bool,
    created_at: i64,
) -> Result<i64, String> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO ws_streams (project_id, destination, path, is_tls, created_at, status, message_count)
         VALUES (?, ?, ?, ?, ?, 'open', 0)
         RETURNING id",
    )
    .bind(project_id)
    .bind(destination)
    .bind(path)
    .bind(is_tls)
    .bind(created_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to save ws stream: {e}"))?;

    Ok(row.0)
}

/// Marks a WebSocket stream as closed.
pub async fn close_ws_stream(
    pool: &SqlitePool,
    stream_id: i64,
    status: &str,
    closed_at: i64,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE ws_streams
         SET status = ?, closed_at = ?
         WHERE id = ?",
    )
    .bind(status)
    .bind(closed_at)
    .bind(stream_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to close ws stream: {e}"))?;

    Ok(())
}

/// Inserts a WebSocket message and increments the stream's message count.
pub async fn save_ws_message(
    pool: &SqlitePool,
    stream_id: i64,
    project_id: &str,
    direction: &str,
    message_type: &str,
    payload: &str,
    payload_length: i64,
    sent_at: i64,
) -> Result<i64, String> {
    let mut tx = pool.begin().await.map_err(|e| format!("Failed to start transaction: {e}"))?;

    let row: (i64,) = sqlx::query_as(
        "INSERT INTO ws_messages (stream_id, project_id, direction, message_type, payload, payload_length, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(stream_id)
    .bind(project_id)
    .bind(direction)
    .bind(message_type)
    .bind(payload)
    .bind(payload_length)
    .bind(sent_at)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Failed to insert ws message: {e}"))?;

    sqlx::query(
        "UPDATE ws_streams
         SET message_count = message_count + 1
         WHERE id = ?",
    )
    .bind(stream_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to increment stream message count: {e}"))?;

    tx.commit().await.map_err(|e| format!("Failed to commit transaction: {e}"))?;

    Ok(row.0)
}

/// Lists all WebSocket streams for a project, newest first.
pub async fn get_ws_streams(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<WsStreamRow>, String> {
    sqlx::query_as::<_, WsStreamRow>(
        "SELECT id, project_id, destination, path, is_tls, created_at, closed_at, status, message_count
         FROM ws_streams
         WHERE project_id = ?
         ORDER BY id DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get ws streams: {e}"))
}

/// Lists all WebSocket messages for a specific stream, ordered chronologically.
pub async fn get_ws_messages(
    pool: &SqlitePool,
    stream_id: i64,
) -> Result<Vec<WsMessageRow>, String> {
    sqlx::query_as::<_, WsMessageRow>(
        "SELECT id, stream_id, project_id, direction, message_type, payload, payload_length, sent_at
         FROM ws_messages
         WHERE stream_id = ?
         ORDER BY id ASC",
    )
    .bind(stream_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get ws messages: {e}"))
}

/// Clears all WebSocket streams and messages for a project.
pub async fn clear_ws_history(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM ws_streams WHERE project_id = ?")
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to clear ws history: {e}"))?;

    Ok(())
}

/// Deletes a single WebSocket message by ID and decrements the stream's message count.
pub async fn delete_ws_message(
    pool: &SqlitePool,
    message_id: i64,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| format!("Failed to start transaction: {e}"))?;

    let row: Option<(i64,)> = sqlx::query_as("SELECT stream_id FROM ws_messages WHERE id = ?")
        .bind(message_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("Failed to find message: {e}"))?;

    if let Some((stream_id,)) = row {
        sqlx::query("DELETE FROM ws_messages WHERE id = ?")
            .bind(message_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete ws message: {e}"))?;

        sqlx::query("UPDATE ws_streams SET message_count = MAX(0, message_count - 1) WHERE id = ?")
            .bind(stream_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to decrement stream message count: {e}"))?;
    }

    tx.commit().await.map_err(|e| format!("Failed to commit transaction: {e}"))?;
    Ok(())
}

/// Deletes all messages for a specific stream and resets its message count to 0.
pub async fn delete_ws_stream_messages(
    pool: &SqlitePool,
    stream_id: i64,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| format!("Failed to start transaction: {e}"))?;

    sqlx::query("DELETE FROM ws_messages WHERE stream_id = ?")
        .bind(stream_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete stream messages: {e}"))?;

    sqlx::query("UPDATE ws_streams SET message_count = 0 WHERE id = ?")
        .bind(stream_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to reset stream message count: {e}"))?;

    tx.commit().await.map_err(|e| format!("Failed to commit transaction: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn create_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            "CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);
             CREATE TABLE ws_streams (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 project_id    TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 destination   TEXT    NOT NULL,
                 path          TEXT    NOT NULL,
                 is_tls        INTEGER NOT NULL DEFAULT 1,
                 created_at    INTEGER NOT NULL,
                 closed_at     INTEGER,
                 status        TEXT    NOT NULL DEFAULT 'open',
                 message_count INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE ws_messages (
                 id             INTEGER PRIMARY KEY AUTOINCREMENT,
                 stream_id      INTEGER NOT NULL REFERENCES ws_streams(id) ON DELETE CASCADE,
                 project_id     TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 direction      TEXT    NOT NULL,
                 message_type   TEXT    NOT NULL,
                 payload        TEXT    NOT NULL,
                 payload_length INTEGER NOT NULL DEFAULT 0,
                 sent_at        INTEGER NOT NULL
             );",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO projects (id) VALUES ('test-proj')")
            .execute(&pool)
            .await
            .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_ws_stream_and_messages_lifecycle() {
        let pool = create_test_db().await;

        let stream_id = save_ws_stream(&pool, "test-proj", "wss://echo.websocket.events", "/ws", true, 1000)
            .await
            .expect("Failed to save stream");

        let streams = get_ws_streams(&pool, "test-proj").await.unwrap();
        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0].id, stream_id);
        assert_eq!(streams[0].destination, "wss://echo.websocket.events");
        assert_eq!(streams[0].status, "open");
        assert_eq!(streams[0].message_count, 0);

        let msg_id1 = save_ws_message(&pool, stream_id, "test-proj", "ClientToServer", "Text", "hello", 5, 1010)
            .await
            .expect("Failed to save msg 1");
        let msg_id2 = save_ws_message(&pool, stream_id, "test-proj", "ServerToClient", "Text", "hello echo", 10, 1020)
            .await
            .expect("Failed to save msg 2");

        let messages = get_ws_messages(&pool, stream_id).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].id, msg_id1);
        assert_eq!(messages[0].direction, "ClientToServer");
        assert_eq!(messages[0].payload, "hello");
        assert_eq!(messages[1].id, msg_id2);
        assert_eq!(messages[1].direction, "ServerToClient");
        assert_eq!(messages[1].payload, "hello echo");

        let updated_streams = get_ws_streams(&pool, "test-proj").await.unwrap();
        assert_eq!(updated_streams[0].message_count, 2);

        close_ws_stream(&pool, stream_id, "closed", 2000).await.unwrap();
        let closed_streams = get_ws_streams(&pool, "test-proj").await.unwrap();
        assert_eq!(closed_streams[0].status, "closed");
        assert_eq!(closed_streams[0].closed_at, Some(2000));

        // Delete a single message
        delete_ws_message(&pool, msg_id1).await.unwrap();
        let remaining_msgs = get_ws_messages(&pool, stream_id).await.unwrap();
        assert_eq!(remaining_msgs.len(), 1);
        assert_eq!(remaining_msgs[0].id, msg_id2);
        let stream_after_delete = get_ws_streams(&pool, "test-proj").await.unwrap();
        assert_eq!(stream_after_delete[0].message_count, 1);

        // Delete all messages for stream
        delete_ws_stream_messages(&pool, stream_id).await.unwrap();
        let no_msgs = get_ws_messages(&pool, stream_id).await.unwrap();
        assert!(no_msgs.is_empty());
        let stream_after_clear = get_ws_streams(&pool, "test-proj").await.unwrap();
        assert_eq!(stream_after_clear[0].message_count, 0);

        clear_ws_history(&pool, "test-proj").await.unwrap();
        let empty_streams = get_ws_streams(&pool, "test-proj").await.unwrap();
        assert!(empty_streams.is_empty());
        let empty_msgs = get_ws_messages(&pool, stream_id).await.unwrap();
        assert!(empty_msgs.is_empty());
    }
}
