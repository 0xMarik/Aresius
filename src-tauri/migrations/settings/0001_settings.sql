CREATE TABLE IF NOT EXISTS global_settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT
);

-- Seed default settings
INSERT OR IGNORE INTO global_settings (key, value) VALUES
    ('sidebar_collapsed', 'false'),
    ('active_project_id', NULL),
    ('last_page',         '/projects'),
    ('proxy_host', '127.0.0.1'),
    ('proxy_port', '8080'),
    ('proxy_auto_fallback_port', 'true'),
    ('proxy_auto_fallback_loopback', 'true'),
    ('fuzzer_show_uncompleted_requests', 'false'),
    ('show_splashscreen', 'true'),
    ('startup_project_mode', 'last_used'),
    ('startup_project_specific_id', NULL);
