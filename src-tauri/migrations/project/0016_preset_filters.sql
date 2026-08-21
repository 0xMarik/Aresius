-- ─────────────────────────────────────────────────────────────────────────────
-- PRESET FILTERS TABLE
-- Stores named HTTPQL preset filters per project.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preset_filters (
    id                    TEXT PRIMARY KEY NOT NULL,
    project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    alias                 TEXT NOT NULL,
    expression            TEXT NOT NULL,
    description           TEXT NOT NULL DEFAULT '',
    badge                 TEXT NOT NULL DEFAULT '',
    apply_in_interception INTEGER NOT NULL DEFAULT 0 CHECK (apply_in_interception IN (0, 1)),
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preset_filters_project ON preset_filters (project_id);
CREATE INDEX IF NOT EXISTS idx_preset_filters_alias ON preset_filters (project_id, alias);
CREATE INDEX IF NOT EXISTS idx_preset_filters_interception ON preset_filters (project_id, apply_in_interception);
