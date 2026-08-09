CREATE TABLE http_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id       TEXT    NOT NULL REFERENCES projects(id),
    host             TEXT    NOT NULL,
    method           TEXT    NOT NULL,
    path             TEXT    NOT NULL,
    query            TEXT,
    extension        TEXT,
    status_code      INTEGER NOT NULL DEFAULT 0,
    response_length  INTEGER NOT NULL DEFAULT 0,  -- bytes
    response_time_ms INTEGER NOT NULL DEFAULT 0,
    sent_at_ms       INTEGER NOT NULL,             -- Unix ms timestamp
    state            TEXT    NOT NULL CHECK (state IN ('Pending','Info','Success','Redirect','Client Error','Server Error','Failed')),
    is_https         INTEGER NOT NULL DEFAULT 0,   -- BOOLEAN
    raw_request      TEXT    NOT NULL,
    raw_response     TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_http_history_project_id          ON http_history (project_id);
CREATE INDEX idx_http_history_project_host         ON http_history (project_id, host);
CREATE INDEX idx_http_history_project_status_code  ON http_history (project_id, status_code);
CREATE INDEX idx_http_history_sent_at_ms           ON http_history (sent_at_ms);
