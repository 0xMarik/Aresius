CREATE TABLE IF NOT EXISTS http_history_state (
    project_id TEXT PRIMARY KEY NOT NULL,
    httpql_query TEXT NOT NULL DEFAULT '',
    scope_filter TEXT NOT NULL DEFAULT 'in',
    selected_request_id INTEGER,
    apply_interception_filters INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
