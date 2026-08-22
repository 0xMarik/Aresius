-- Seed proxy settings into app_state
INSERT OR IGNORE INTO app_state (key, value) VALUES
    ('proxy_host', '127.0.0.1'),
    ('proxy_port', '8080'),
    ('proxy_auto_fallback_port', 'true'),
    ('proxy_auto_fallback_loopback', 'true');
