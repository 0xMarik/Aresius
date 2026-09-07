CREATE TABLE IF NOT EXISTS http_history_ui_state (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ui_state TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);
