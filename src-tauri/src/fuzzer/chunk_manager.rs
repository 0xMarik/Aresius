use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};

/// Compresses a slice of raw response strings using Zstandard (level 3).
pub fn compress_chunk(responses: &[String]) -> Result<Vec<u8>, String> {
    let serialized = serde_json::to_vec(responses).map_err(|e| e.to_string())?;
    zstd::encode_all(serialized.as_slice(), 3).map_err(|e| e.to_string())
}

/// Decompresses a Zstandard-compressed blob back into response strings.
pub fn decompress_chunk(compressed_data: &[u8]) -> Result<Vec<String>, String> {
    let decompressed = zstd::decode_all(compressed_data).map_err(|e| e.to_string())?;
    serde_json::from_slice(&decompressed).map_err(|e| e.to_string())
}

/// Returns the target number of responses per chunk for a given HTTP status code.
/// 4xx client errors (400..=499) use 500 requests per chunk to maximize compression.
/// All other status codes use 250 requests per chunk.
#[inline]
pub fn target_chunk_capacity_for_status(status_code: i64) -> usize {
    if (400..=499).contains(&status_code) {
        500
    } else {
        250
    }
}

/// Returns the byte safety ceiling for a chunk based on its status code.
#[inline]
pub fn target_byte_capacity_for_status(status_code: i64) -> usize {
    if (400..=499).contains(&status_code) {
        5_000_000
    } else {
        2_500_000
    }
}

/// In-memory LRU cache for decompressed response chunks.
pub struct ChunkCache {
    capacity: usize,
    order: VecDeque<i64>,
    entries: HashMap<i64, Arc<Vec<String>>>,
}

impl ChunkCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            order: VecDeque::with_capacity(capacity),
            entries: HashMap::with_capacity(capacity),
        }
    }

    pub fn get(&mut self, chunk_id: i64) -> Option<Arc<Vec<String>>> {
        if let Some(entry) = self.entries.get(&chunk_id).cloned() {
            if let Some(pos) = self.order.iter().position(|&id| id == chunk_id) {
                self.order.remove(pos);
                self.order.push_back(chunk_id);
            }
            Some(entry)
        } else {
            None
        }
    }

    pub fn insert(&mut self, chunk_id: i64, chunk: Vec<String>) -> Arc<Vec<String>> {
        if self.entries.contains_key(&chunk_id) {
            let arc = Arc::new(chunk);
            self.entries.insert(chunk_id, arc.clone());
            if let Some(pos) = self.order.iter().position(|&id| id == chunk_id) {
                self.order.remove(pos);
            }
            self.order.push_back(chunk_id);
            return arc;
        }

        if self.entries.len() >= self.capacity {
            if let Some(evicted_id) = self.order.pop_front() {
                self.entries.remove(&evicted_id);
            }
        }

        let arc = Arc::new(chunk);
        self.entries.insert(chunk_id, arc.clone());
        self.order.push_back(chunk_id);
        arc
    }

    pub fn clear(&mut self) {
        self.order.clear();
        self.entries.clear();
    }
}

static CHUNK_CACHE: OnceLock<Mutex<ChunkCache>> = OnceLock::new();

pub fn get_chunk_cache() -> &'static Mutex<ChunkCache> {
    CHUNK_CACHE.get_or_init(|| Mutex::new(ChunkCache::new(32)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_compression_roundtrip() {
        let responses = vec![
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nServer: nginx\r\n\r\n<html><body>Page 1</body></html>".to_string(),
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nServer: nginx\r\n\r\n<html><body>Page 2</body></html>".to_string(),
            "HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\nServer: nginx\r\n\r\n<html><body>Not Found</body></html>".to_string(),
        ];

        let compressed = compress_chunk(&responses).expect("compression failed");
        assert!(!compressed.is_empty());

        let decompressed = decompress_chunk(&compressed).expect("decompression failed");
        assert_eq!(decompressed, responses);
    }

    #[test]
    fn test_chunk_compression_efficiency() {
        // Create 100 similar HTTP responses
        let mut responses = Vec::new();
        for i in 0..100 {
            responses.push(format!(
                "HTTP/1.1 200 OK\r\nServer: Apache/2.4.41\r\nContent-Type: application/json\r\nDate: Tue, 25 Aug 2026 12:00:00 GMT\r\n\r\n{{\"status\":\"success\",\"id\":{},\"message\":\"User data retrieved successfully\"}}",
                i
            ));
        }

        let uncompressed_size: usize = responses.iter().map(|s| s.len()).sum();
        let compressed = compress_chunk(&responses).expect("compression failed");

        // Assert at least 70% compression on repetitive HTTP responses
        let ratio = compressed.len() as f64 / uncompressed_size as f64;
        assert!(ratio < 0.3, "Expected compression ratio < 0.3, got {}", ratio);

        let decompressed = decompress_chunk(&compressed).expect("decompression failed");
        assert_eq!(decompressed.len(), 100);
        assert_eq!(decompressed[50], responses[50]);
    }

    #[test]
    fn test_lru_cache_operations() {
        let mut cache = ChunkCache::new(2);

        let chunk1 = vec!["resp1".to_string()];
        let chunk2 = vec!["resp2".to_string()];
        let chunk3 = vec!["resp3".to_string()];

        cache.insert(1, chunk1);
        cache.insert(2, chunk2);

        assert!(cache.get(1).is_some());
        // Inserting chunk 3 should evict chunk 2 because chunk 1 was recently accessed
        cache.insert(3, chunk3);

        assert!(cache.get(1).is_some());
        assert!(cache.get(2).is_none());
        assert!(cache.get(3).is_some());
    }

    #[test]
    fn test_target_chunk_capacity_for_status() {
        // 4xx client errors should have 500 capacity
        assert_eq!(target_chunk_capacity_for_status(400), 500);
        assert_eq!(target_chunk_capacity_for_status(404), 500);
        assert_eq!(target_chunk_capacity_for_status(403), 500);
        assert_eq!(target_chunk_capacity_for_status(499), 500);

        // Non-4xx should have 250 capacity
        assert_eq!(target_chunk_capacity_for_status(200), 250);
        assert_eq!(target_chunk_capacity_for_status(201), 250);
        assert_eq!(target_chunk_capacity_for_status(301), 250);
        assert_eq!(target_chunk_capacity_for_status(302), 250);
        assert_eq!(target_chunk_capacity_for_status(500), 250);
        assert_eq!(target_chunk_capacity_for_status(502), 250);
        assert_eq!(target_chunk_capacity_for_status(0), 250);
    }

    #[test]
    fn test_homogeneous_404_chunk_500_compression() {
        // Create 500 homogeneous 404 responses
        let mut responses = Vec::with_capacity(500);
        for i in 0..500 {
            responses.push(format!(
                "HTTP/1.1 404 Not Found\r\nServer: nginx/1.18.0\r\nContent-Type: text/html\r\nContent-Length: 153\r\nConnection: keep-alive\r\n\r\n<html><head><title>404 Not Found</title></head><body><h1>404 Not Found (path_{})</h1></body></html>",
                i
            ));
        }

        let uncompressed_size: usize = responses.iter().map(|s| s.len()).sum();
        let compressed = compress_chunk(&responses).expect("compression failed");

        // 500 homogeneous responses should achieve > 90% compression (ratio < 0.10)
        let ratio = compressed.len() as f64 / uncompressed_size as f64;
        assert!(ratio < 0.10, "Expected compression ratio < 0.10 for 500 404s, got {}", ratio);

        let decompressed = decompress_chunk(&compressed).expect("decompression failed");
        assert_eq!(decompressed.len(), 500);
        assert_eq!(decompressed[499], responses[499]);
    }

    #[tokio::test]
    async fn test_fts5_trigram_support() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE VIRTUAL TABLE test_fts USING fts5(body, content='', contentless_delete=1, tokenize='trigram');")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO test_fts(rowid, body) VALUES (1, 'hello world test');")
            .execute(&pool)
            .await
            .unwrap();

        let rowid: i64 = sqlx::query_scalar("SELECT rowid FROM test_fts WHERE test_fts MATCH 'wor';")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(rowid, 1);

        sqlx::query("DELETE FROM test_fts WHERE rowid = 1;")
            .execute(&pool)
            .await
            .unwrap();

        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM test_fts WHERE test_fts MATCH 'wor';")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(count, 0);
    }
}
