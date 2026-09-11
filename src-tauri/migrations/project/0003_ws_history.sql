CREATE TABLE IF NOT EXISTS ws_streams (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    destination   TEXT    NOT NULL,
    path          TEXT    NOT NULL,
    is_tls        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    closed_at     INTEGER,
    status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'error')),
    message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ws_messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    stream_id      INTEGER NOT NULL REFERENCES ws_streams(id) ON DELETE CASCADE,
    project_id     TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    direction      TEXT    NOT NULL CHECK (direction IN ('ClientToServer', 'ServerToClient')),
    message_type   TEXT    NOT NULL CHECK (message_type IN ('Text', 'Binary', 'Ping', 'Pong', 'Close')),
    payload        TEXT    NOT NULL,
    payload_length INTEGER NOT NULL DEFAULT 0,
    sent_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ws_streams_project ON ws_streams (project_id);
CREATE INDEX IF NOT EXISTS idx_ws_messages_stream ON ws_messages (stream_id);
CREATE INDEX IF NOT EXISTS idx_ws_messages_project ON ws_messages (project_id);
CREATE INDEX IF NOT EXISTS idx_ws_messages_sent_at ON ws_messages (sent_at);
