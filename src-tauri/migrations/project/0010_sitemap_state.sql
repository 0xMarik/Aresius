CREATE TABLE IF NOT EXISTS sitemap_state (
    project_id           TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    selected_node_id     TEXT,
    selected_request_id  INTEGER,
    expanded_ids         TEXT NOT NULL DEFAULT '[]',
    search_term          TEXT NOT NULL DEFAULT '',
    scope_filter         TEXT NOT NULL DEFAULT 'all',
    req_view_mode        TEXT NOT NULL DEFAULT 'raw',
    res_view_mode        TEXT NOT NULL DEFAULT 'raw',
    updated_at           INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
