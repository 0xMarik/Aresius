CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT             -- JSON or plain string; NULL is valid (e.g. no active project)
);

-- Seed defaults so reads are always a simple SELECT.
INSERT OR IGNORE INTO app_state (key, value) VALUES
    ('sidebar_collapsed', 'false'),
    ('active_project_id', NULL),
    ('last_page',         '/projects');
