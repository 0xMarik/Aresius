-- Add session_type to replayer_sessions ('http' | 'ws')
ALTER TABLE replayer_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'http';

-- Table storing messages exchanged during a replayer WebSocket connection
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
