-- 1. Fuzzer Sessions (Configuration per session)
CREATE TABLE fuzzer_sessions (
    id            TEXT    PRIMARY KEY NOT NULL, -- UUID v4 or string ID
    project_id    TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL DEFAULT 'New Session',
    raw_request   TEXT    NOT NULL DEFAULT '',
    attack_type   TEXT    NOT NULL DEFAULT 'rotator',
    num_threads   INTEGER NOT NULL DEFAULT 4,
    delay_ms      INTEGER NOT NULL DEFAULT 0,
    target_url    TEXT    NOT NULL DEFAULT '',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_expanded   INTEGER NOT NULL DEFAULT 1,
    is_selected   INTEGER NOT NULL DEFAULT 0,
    selected_history_index INTEGER,
    created_at    INTEGER NOT NULL
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
    sort_order     INTEGER NOT NULL DEFAULT 0
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
    completed_base      INTEGER NOT NULL DEFAULT 0,
    connection_dropped  INTEGER NOT NULL DEFAULT 0,
    started_at          INTEGER NOT NULL,
    finished_at         INTEGER
);
CREATE INDEX idx_fuzzer_runs_session_id ON fuzzer_runs (session_id);
CREATE INDEX idx_fuzzer_runs_session_started ON fuzzer_runs (session_id, started_at);

-- 5. Fuzzer Workers (Worker thread telemetry)
CREATE TABLE fuzzer_workers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    run_id        TEXT    NOT NULL REFERENCES fuzzer_runs(id) ON DELETE CASCADE,
    worker_id     INTEGER NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending',
    total         INTEGER NOT NULL DEFAULT 0,
    completed     INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);
CREATE INDEX idx_fuzzer_workers_run_id ON fuzzer_workers (run_id);
CREATE INDEX idx_fuzzer_workers_run_worker ON fuzzer_workers (run_id, worker_id);

-- 6. Fuzzer Requests (Individual fuzzed transactions)
CREATE TABLE fuzzer_requests (
    id                  TEXT    NOT NULL, -- fuzzRequestId
    run_id              TEXT    NOT NULL REFERENCES fuzzer_runs(id) ON DELETE CASCADE,
    worker_id           INTEGER,
    raw_request         TEXT    NOT NULL,
    raw_response        TEXT,
    status_code         INTEGER,
    response_length     INTEGER,
    response_time_ms    INTEGER,
    request_date        INTEGER NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'pending',
    error_message       TEXT,
    connection_dropped  INTEGER NOT NULL DEFAULT 0,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, id)
);
CREATE INDEX idx_fuzzer_requests_run_id ON fuzzer_requests (run_id);
CREATE INDEX idx_fuzzer_requests_status ON fuzzer_requests (run_id, status);
CREATE INDEX idx_fuzzer_requests_sort_code ON fuzzer_requests (run_id, status_code);
CREATE INDEX idx_fuzzer_requests_sort_duration ON fuzzer_requests (run_id, response_time_ms);
CREATE INDEX idx_fuzzer_requests_sort_length ON fuzzer_requests (run_id, response_length);
