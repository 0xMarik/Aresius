CREATE TABLE IF NOT EXISTS match_replace_collections (
    id          TEXT PRIMARY KEY NOT NULL,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_replace_collections_proj ON match_replace_collections (project_id);

CREATE TABLE IF NOT EXISTS match_replace_rules (
    id                 TEXT PRIMARY KEY NOT NULL,
    collection_id      TEXT NOT NULL REFERENCES match_replace_collections(id) ON DELETE CASCADE,
    project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    enabled            INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    rule_type          TEXT NOT NULL,
    match_pattern      TEXT NOT NULL,
    replace_pattern    TEXT NOT NULL DEFAULT '',
    comment            TEXT NOT NULL DEFAULT '',
    is_regex           INTEGER NOT NULL DEFAULT 0 CHECK (is_regex IN (0, 1)),
    is_case_sensitive  INTEGER NOT NULL DEFAULT 0 CHECK (is_case_sensitive IN (0, 1)),
    only_in_scope      INTEGER NOT NULL DEFAULT 1 CHECK (only_in_scope IN (0, 1)),
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_replace_rules_col ON match_replace_rules (collection_id);
CREATE INDEX IF NOT EXISTS idx_match_replace_rules_proj ON match_replace_rules (project_id);
CREATE INDEX IF NOT EXISTS idx_match_replace_rules_enabled ON match_replace_rules (project_id, enabled);
