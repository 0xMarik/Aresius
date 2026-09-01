CREATE TABLE IF NOT EXISTS http_history_state (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    httpql_query TEXT NOT NULL DEFAULT '',
    scope_filter TEXT NOT NULL DEFAULT 'in',
    selected_request_id INTEGER REFERENCES http_history(id) ON DELETE SET NULL,
    apply_interception_filters INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
