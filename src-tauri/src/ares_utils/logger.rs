use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::State;
use tracing::{field::Visit, Event, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::prelude::*;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::{reload, EnvFilter, Layer, Registry};

// ---------------------------------------------------------------------------
// LogEntry Model & Ring Buffer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub timestamp: i64,
    pub level: String,
    pub target: String,
    pub message: String,
    pub spans: Option<String>,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSettings {
    pub active_level: String,
    pub filter_directive: String,
    pub log_dir: String,
    pub total_cached_logs: usize,
}

pub struct LogRingBuffer {
    max_entries: usize,
    entries: VecDeque<LogEntry>,
    next_id: AtomicU64,
}

impl LogRingBuffer {
    pub fn new(max_entries: usize) -> Self {
        Self {
            max_entries,
            entries: VecDeque::with_capacity(max_entries),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn push(&mut self, entry: LogEntry) {
        if self.entries.len() >= self.max_entries {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn query(
        &self,
        limit: Option<usize>,
        min_level: Option<&str>,
        target: Option<&str>,
        search: Option<&str>,
    ) -> Vec<LogEntry> {
        let max_items = limit.unwrap_or(200).min(self.max_entries);
        let search_lower = search.map(|s| s.to_lowercase());
        let target_lower = target.map(|t| t.to_lowercase());

        let min_severity = min_level.and_then(level_severity);

        self.entries
            .iter()
            .rev()
            .filter(|e| {
                if let Some(min_sev) = min_severity {
                    let e_sev = level_severity(&e.level).unwrap_or(0);
                    if e_sev < min_sev {
                        return false;
                    }
                }

                if let Some(ref t) = target_lower {
                    if !e.target.to_lowercase().contains(t) {
                        return false;
                    }
                }

                if let Some(ref q) = search_lower {
                    let in_msg = e.message.to_lowercase().contains(q);
                    let in_target = e.target.to_lowercase().contains(q);
                    let in_spans = e.spans.as_ref().map_or(false, |s| s.to_lowercase().contains(q));
                    if !in_msg && !in_target && !in_spans {
                        return false;
                    }
                }

                true
            })
            .take(max_items)
            .cloned()
            .collect()
    }
}

fn level_severity(level_str: &str) -> Option<u8> {
    match level_str.to_uppercase().as_str() {
        "ERROR" => Some(5),
        "WARN" => Some(4),
        "INFO" => Some(3),
        "DEBUG" => Some(2),
        "TRACE" => Some(1),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tracing In-Memory Layer
// ---------------------------------------------------------------------------

struct LogFieldVisitor {
    message: String,
    fields: HashMap<String, String>,
}

impl Visit for LogFieldVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            let mut formatted = format!("{:?}", value);
            if formatted.starts_with('"') && formatted.ends_with('"') && formatted.len() >= 2 {
                formatted = formatted[1..formatted.len() - 1].to_string();
            }
            self.message = formatted;
        } else {
            self.fields
                .insert(field.name().to_string(), format!("{:?}", value));
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.fields.insert(field.name().to_string(), value.to_string());
        }
    }
}

pub struct MemoryLogLayer {
    buffer: Arc<RwLock<LogRingBuffer>>,
}

impl MemoryLogLayer {
    pub fn new(buffer: Arc<RwLock<LogRingBuffer>>) -> Self {
        Self { buffer }
    }
}

impl<S> Layer<S> for MemoryLogLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        let metadata = event.metadata();

        let mut visitor = LogFieldVisitor {
            message: String::new(),
            fields: HashMap::new(),
        };
        event.record(&mut visitor);

        let spans_str = ctx.event_scope(event).and_then(|scope| {
            let mut names = Vec::new();
            for span in scope.from_root() {
                names.push(span.name());
            }
            if names.is_empty() {
                None
            } else {
                Some(names.join(" > "))
            }
        });

        let now_ms = chrono::Utc::now().timestamp_millis();

        let id = {
            if let Ok(buf) = self.buffer.read() {
                buf.next_id.fetch_add(1, Ordering::Relaxed)
            } else {
                1
            }
        };

        let entry = LogEntry {
            id,
            timestamp: now_ms,
            level: metadata.level().to_string(),
            target: metadata.target().to_string(),
            message: visitor.message,
            spans: spans_str,
            fields: visitor.fields,
        };

        if let Ok(mut buf) = self.buffer.write() {
            buf.push(entry);
        }
    }
}

// ---------------------------------------------------------------------------
// Log State & Initialization
// ---------------------------------------------------------------------------

pub type LogReloadHandle = reload::Handle<EnvFilter, Registry>;

pub struct LogState {
    reload_handle: LogReloadHandle,
    ring_buffer: Arc<RwLock<LogRingBuffer>>,
    active_level: Arc<RwLock<String>>,
    filter_directive: Arc<RwLock<String>>,
    log_dir: PathBuf,
    _worker_guard: Arc<Mutex<Option<tracing_appender::non_blocking::WorkerGuard>>>,
}

impl LogState {
    pub fn log_dir(&self) -> &Path {
        &self.log_dir
    }

    pub fn active_level(&self) -> String {
        self.active_level.read().unwrap().clone()
    }

    pub fn filter_directive(&self) -> String {
        self.filter_directive.read().unwrap().clone()
    }

    pub fn set_level(&self, level: &str) -> Result<(), String> {
        let norm = level.trim().to_lowercase();
        let directive = match norm.as_str() {
            "error" => "aresius=error,tauri=warn",
            "warn" => "aresius=warn,tauri=warn",
            "info" => "aresius=info,tauri=info",
            "debug" => "aresius=debug,tauri=info",
            "trace" => "aresius=trace,tauri=debug",
            _ => return Err(format!("Invalid log level: '{}'. Use error, warn, info, debug, or trace.", level)),
        };

        self.set_directive(directive, &norm)
    }

    pub fn set_directive(&self, directive: &str, level_label: &str) -> Result<(), String> {
        let new_filter = EnvFilter::try_new(directive)
            .map_err(|e| format!("Invalid tracing filter directive: {e}"))?;

        self.reload_handle
            .modify(|filter| *filter = new_filter)
            .map_err(|e| format!("Failed to reload tracing filter: {e}"))?;

        if let Ok(mut lvl) = self.active_level.write() {
            *lvl = level_label.to_string();
        }
        if let Ok(mut dir) = self.filter_directive.write() {
            *dir = directive.to_string();
        }

        tracing::info!("Log filter updated to: {}", directive);
        Ok(())
    }
}

pub fn default_log_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("com.aresius").join("logs");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join("Library/Application Support/com.aresius/logs");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".config/com.aresius/logs");
        }
    }
    PathBuf::from("logs")
}

pub fn prune_old_logs(dir: &Path, max_age_days: u64) {
    let now = std::time::SystemTime::now();
    let max_duration = std::time::Duration::from_secs(max_age_days * 24 * 3600);

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    if file_name.starts_with("aresius.") && file_name.ends_with(".log") {
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                if let Ok(age) = now.duration_since(modified) {
                                    if age > max_duration {
                                        let _ = std::fs::remove_file(&path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

pub fn init_logging(custom_log_dir: Option<PathBuf>) -> Result<LogState, String> {
    let log_dir = custom_log_dir.unwrap_or_else(default_log_dir);
    let _ = std::fs::create_dir_all(&log_dir);
    prune_old_logs(&log_dir, 14);

    let default_directive = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "aresius=debug,tauri=info".to_string());

    let initial_level = if default_directive.contains("trace") {
        "trace"
    } else if default_directive.contains("debug") {
        "debug"
    } else if default_directive.contains("warn") {
        "warn"
    } else if default_directive.contains("error") {
        "error"
    } else {
        "info"
    };

    let env_filter = EnvFilter::try_new(&default_directive)
        .unwrap_or_else(|_| EnvFilter::new("aresius=debug,tauri=info"));

    let (filter_layer, reload_handle) = reload::Layer::new(env_filter);

    let ring_buffer = Arc::new(RwLock::new(LogRingBuffer::new(1000)));
    let memory_layer = MemoryLogLayer::new(ring_buffer.clone());

    let stdout_layer = tracing_subscriber::fmt::layer()
        .with_target(true);

    let (file_layer, guard) = if log_dir.exists() {
        let file_appender = tracing_appender::rolling::daily(&log_dir, "aresius.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        let layer = tracing_subscriber::fmt::layer()
            .with_writer(non_blocking)
            .with_ansi(false)
            .with_target(true);
        (Some(layer), Some(guard))
    } else {
        (None, None)
    };

    tracing_subscriber::registry()
        .with(filter_layer)
        .with(stdout_layer)
        .with(file_layer)
        .with(memory_layer)
        .init();

    tracing::info!("Tracing logger initialized. Log directory: {}", log_dir.display());

    Ok(LogState {
        reload_handle,
        ring_buffer,
        active_level: Arc::new(RwLock::new(initial_level.to_string())),
        filter_directive: Arc::new(RwLock::new(default_directive)),
        log_dir,
        _worker_guard: Arc::new(Mutex::new(guard)),
    })
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_log_settings(state: State<'_, LogState>) -> Result<LogSettings, String> {
    let total = state
        .ring_buffer
        .read()
        .map(|b| b.len())
        .unwrap_or(0);

    Ok(LogSettings {
        active_level: state.active_level(),
        filter_directive: state.filter_directive(),
        log_dir: state.log_dir().to_string_lossy().to_string(),
        total_cached_logs: total,
    })
}

#[tauri::command]
pub fn set_log_level(state: State<'_, LogState>, level: String) -> Result<(), String> {
    state.set_level(&level)
}

#[tauri::command]
pub fn set_custom_log_filter(state: State<'_, LogState>, directive: String) -> Result<(), String> {
    state.set_directive(&directive, "custom")
}

#[tauri::command]
pub fn get_recent_logs(
    state: State<'_, LogState>,
    limit: Option<usize>,
    min_level: Option<String>,
    target: Option<String>,
    search: Option<String>,
) -> Result<Vec<LogEntry>, String> {
    let buf = state
        .ring_buffer
        .read()
        .map_err(|e| format!("Failed to acquire read lock on log buffer: {e}"))?;

    Ok(buf.query(
        limit,
        min_level.as_deref(),
        target.as_deref(),
        search.as_deref(),
    ))
}

#[tauri::command]
pub fn clear_memory_logs(state: State<'_, LogState>) -> Result<(), String> {
    let mut buf = state
        .ring_buffer
        .write()
        .map_err(|e| format!("Failed to acquire write lock on log buffer: {e}"))?;
    buf.clear();
    Ok(())
}

#[tauri::command]
pub async fn open_log_directory(state: State<'_, LogState>) -> Result<(), String> {
    let dir = state.log_dir();
    if !dir.exists() {
        let _ = std::fs::create_dir_all(dir);
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open log directory: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open log directory: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open log directory: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ring_buffer_eviction() {
        let mut buffer = LogRingBuffer::new(3);
        assert_eq!(buffer.len(), 0);

        for i in 1..=5 {
            buffer.push(LogEntry {
                id: i,
                timestamp: i as i64,
                level: "INFO".to_string(),
                target: "test".to_string(),
                message: format!("msg {}", i),
                spans: None,
                fields: HashMap::new(),
            });
        }

        assert_eq!(buffer.len(), 3);
        let entries = buffer.query(None, None, None, None);
        assert_eq!(entries.len(), 3);
        // Reverse order (most recent first):
        assert_eq!(entries[0].id, 5);
        assert_eq!(entries[1].id, 4);
        assert_eq!(entries[2].id, 3);
    }

    #[test]
    fn test_ring_buffer_filtering() {
        let mut buffer = LogRingBuffer::new(10);
        buffer.push(LogEntry {
            id: 1,
            timestamp: 100,
            level: "DEBUG".to_string(),
            target: "aresius::proxy".to_string(),
            message: "handshake started".to_string(),
            spans: None,
            fields: HashMap::new(),
        });
        buffer.push(LogEntry {
            id: 2,
            timestamp: 200,
            level: "ERROR".to_string(),
            target: "aresius::database".to_string(),
            message: "failed to write row".to_string(),
            spans: None,
            fields: HashMap::new(),
        });

        let errors = buffer.query(None, Some("ERROR"), None, None);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].id, 2);

        let proxy_logs = buffer.query(None, None, Some("proxy"), None);
        assert_eq!(proxy_logs.len(), 1);
        assert_eq!(proxy_logs[0].id, 1);

        let search_logs = buffer.query(None, None, None, Some("handshake"));
        assert_eq!(search_logs.len(), 1);
        assert_eq!(search_logs[0].id, 1);
    }
}
