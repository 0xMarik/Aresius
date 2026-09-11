-- 1. Fuzzer Sessions (Configuration per session)
CREATE TABLE fuzzer_sessions (
    id                        TEXT    PRIMARY KEY NOT NULL, -- UUID v4 or string ID
    project_id                TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                      TEXT    NOT NULL DEFAULT 'New Session',
    raw_request               TEXT    NOT NULL DEFAULT '',
    attack_type               TEXT    NOT NULL DEFAULT 'rotator',
    num_threads               INTEGER NOT NULL DEFAULT 4,
    delay_ms                  INTEGER NOT NULL DEFAULT 0,
    target_url                TEXT    NOT NULL DEFAULT '',
    sort_order                INTEGER NOT NULL DEFAULT 0,
    created_at                INTEGER NOT NULL,
    pipeline_scope            TEXT    NOT NULL DEFAULT 'all',
    pipeline_rules            TEXT    NOT NULL DEFAULT '[]',
    set_connection_keep_alive INTEGER NOT NULL DEFAULT 1,
    update_content_length     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_fuzzer_sessions_project_id ON fuzzer_sessions (project_id);

-- 2. Fuzzer Parameters (Highlight ranges in the request template)
CREATE TABLE fuzzer_parameters (
    id             TEXT    PRIMARY KEY NOT NULL, -- UUID v4 or string ID
    session_id     TEXT    NOT NULL REFERENCES fuzzer_sessions(id) ON DELETE CASCADE,
    payload_source TEXT    NOT NULL DEFAULT 'manual',
    range_from     INTEGER NOT NULL,
    range_to       INTEGER NOT NULL,
    byte_from      INTEGER NOT NULL,
    byte_to        INTEGER NOT NULL,
    original_text  TEXT    NOT NULL,
    is_active      INTEGER NOT NULL DEFAULT 1,
    range_id       TEXT    NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    pipeline_rules TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_fuzzer_parameters_session_id ON fuzzer_parameters (session_id);

-- 3. Fuzzer Parameter Values (Wordlists / Payloads)
CREATE TABLE fuzzer_parameter_values (
    id           INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    parameter_id TEXT    NOT NULL REFERENCES fuzzer_parameters(id) ON DELETE CASCADE,
    value        TEXT    NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_fuzzer_parameter_values_param_id ON fuzzer_parameter_values (parameter_id);

-- 4. Fuzzer Runs (History runs)
CREATE TABLE fuzzer_runs (
    id                  TEXT    PRIMARY KEY NOT NULL, -- UUID v4 or string key
    session_id          TEXT    NOT NULL REFERENCES fuzzer_sessions(id) ON DELETE CASCADE,
    config_snapshot     TEXT    NOT NULL, -- JSON blob (FuzzConfig)
    status              TEXT    NOT NULL DEFAULT 'idle',
    total               INTEGER NOT NULL DEFAULT 0,
    completed           INTEGER NOT NULL DEFAULT 0,
    failed              INTEGER NOT NULL DEFAULT 0,
    completed_base      INTEGER NOT NULL DEFAULT 0,
    connection_dropped  INTEGER NOT NULL DEFAULT 0,
    started_at          INTEGER NOT NULL,
    finished_at         INTEGER
);
CREATE INDEX idx_fuzzer_runs_session_id ON fuzzer_runs (session_id);
CREATE INDEX idx_fuzzer_runs_session_started ON fuzzer_runs (session_id, started_at);

-- 5. Fuzzer Chunks (Compressed response chunks grouped by status code)
CREATE TABLE fuzzer_chunks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    run_id              TEXT    NOT NULL REFERENCES fuzzer_runs(id) ON DELETE CASCADE,
    status_code         INTEGER NOT NULL,
    compressed_data     BLOB    NOT NULL,
    uncompressed_bytes  INTEGER NOT NULL,
    item_count          INTEGER NOT NULL
);
CREATE INDEX idx_fuzzer_chunks_run_id ON fuzzer_chunks (run_id);
CREATE INDEX idx_fuzzer_chunks_status_code ON fuzzer_chunks (run_id, status_code);

-- 5b. Fuzzer Chunks Full-Text Search (Contentless Trigram Index pointing to fuzzer_chunks)
CREATE VIRTUAL TABLE fuzzer_chunks_fts USING fts5(
    body,
    content='',
    contentless_delete=1,
    tokenize='trigram'
);

CREATE TRIGGER trg_fuzzer_chunks_delete 
AFTER DELETE ON fuzzer_chunks 
BEGIN
    DELETE FROM fuzzer_chunks_fts WHERE rowid = old.id;
END;

-- 6. Fuzzer Requests (Individual completed fuzzed transactions)
CREATE TABLE fuzzer_requests (
    id                  TEXT    NOT NULL, -- fuzzRequestId
    run_id              TEXT    NOT NULL REFERENCES fuzzer_runs(id) ON DELETE CASCADE,
    worker_id           INTEGER,
    payload             TEXT,
    status_code         INTEGER,
    response_length     INTEGER,
    response_time_ms    INTEGER,
    request_date        INTEGER NOT NULL,
    error_message       TEXT,
    connection_dropped  INTEGER NOT NULL DEFAULT 0,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    chunk_id            INTEGER REFERENCES fuzzer_chunks(id) ON DELETE SET NULL,
    chunk_index         INTEGER,
    PRIMARY KEY (run_id, id)
);
CREATE INDEX idx_fuzzer_requests_run_id ON fuzzer_requests (run_id);
CREATE INDEX idx_fuzzer_requests_sort_order ON fuzzer_requests (run_id, sort_order);
CREATE INDEX idx_fuzzer_requests_sort_code ON fuzzer_requests (run_id, status_code);
CREATE INDEX idx_fuzzer_requests_sort_duration ON fuzzer_requests (run_id, response_time_ms);
CREATE INDEX idx_fuzzer_requests_sort_length ON fuzzer_requests (run_id, response_length);
CREATE INDEX idx_fuzzer_requests_chunk ON fuzzer_requests (chunk_id);
CREATE INDEX idx_fuzzer_requests_sort_payload ON fuzzer_requests (run_id, payload);

-- 7. Fuzzer UI State
CREATE TABLE IF NOT EXISTS fuzzer_ui_state (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ui_state   TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);
