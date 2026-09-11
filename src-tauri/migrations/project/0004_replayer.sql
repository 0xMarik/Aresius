CREATE TABLE replayer_collections (
    id          TEXT    PRIMARY KEY NOT NULL, -- UUID v4
    project_id  TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL DEFAULT 'New Collection',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_expanded INTEGER NOT NULL DEFAULT 1,
    is_selected INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_replayer_collections_project_id ON replayer_collections (project_id);

CREATE TABLE replayer_sessions (
    id                     TEXT    PRIMARY KEY NOT NULL, -- UUID v4
    collection_id          TEXT    NOT NULL REFERENCES replayer_collections(id) ON DELETE CASCADE,
    name                   TEXT    NOT NULL DEFAULT 'New Session',
    base_url               TEXT    NOT NULL DEFAULT '',
    request_tmp            TEXT    NOT NULL DEFAULT '', -- draft request in editor
    sort_order             INTEGER NOT NULL DEFAULT 0,
    is_selected            INTEGER NOT NULL DEFAULT 0,
    selected_history_index INTEGER,
    session_type           TEXT    NOT NULL DEFAULT 'http'
);

CREATE INDEX idx_replayer_sessions_collection_id ON replayer_sessions (collection_id);

CREATE TABLE replayer_history (
    id            TEXT    PRIMARY KEY NOT NULL, -- UUID v4
    session_id    TEXT    NOT NULL REFERENCES replayer_sessions(id) ON DELETE CASCADE,
    request_raw   TEXT    NOT NULL,
    response_raw  TEXT    NOT NULL,
    response_time INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT '',
    error_message TEXT,
    base_url      TEXT
);

CREATE INDEX idx_replayer_history_session_id ON replayer_history (session_id);

CREATE TABLE IF NOT EXISTS replayer_ws_messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    history_id     TEXT NOT NULL REFERENCES replayer_history(id) ON DELETE CASCADE,
    direction      TEXT NOT NULL, -- 'ClientToServer' | 'ServerToClient'
    message_type   TEXT NOT NULL DEFAULT 'Text', -- 'Text' | 'Binary'
    payload        TEXT NOT NULL,
    payload_length INTEGER NOT NULL,
    sent_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replayer_ws_messages_history ON replayer_ws_messages (history_id);
