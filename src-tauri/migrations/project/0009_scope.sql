-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SCOPES TABLE
-- Stores named scope definitions for each project.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE scopes (
    id          TEXT PRIMARY KEY NOT NULL,          -- UUID v4
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,                      -- e.g. "Main Bounty Scope"
    color       TEXT NOT NULL DEFAULT '#6366f1',   -- Hex color for UI badges
    is_active   INTEGER NOT NULL DEFAULT 0          -- 1 = Active, 0 = Inactive
                CHECK (is_active IN (0, 1)),
    created_at  INTEGER NOT NULL,                   -- Unix timestamp in ms
    updated_at  INTEGER NOT NULL                    -- Unix timestamp in ms
);

CREATE INDEX idx_scopes_project_id ON scopes (project_id);
CREATE INDEX idx_scopes_project_active ON scopes (project_id, is_active);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SCOPE RULES TABLE
-- Stores individual allow / deny rules within each scope.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE scope_rules (
    id           TEXT PRIMARY KEY NOT NULL,         -- UUID v4
    scope_id     TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    rule_type    TEXT NOT NULL                      -- 'allow' (include) or 'deny' (exclude)
                 CHECK (rule_type IN ('allow', 'deny')),
    pattern      TEXT NOT NULL,                     -- e.g. "*.target.com", "^.*\.target\.com/api/.*$"
    pattern_type TEXT NOT NULL DEFAULT 'glob'       -- 'glob' or 'regex'
                 CHECK (pattern_type IN ('glob', 'regex')),
    enabled      INTEGER NOT NULL DEFAULT 1         -- 1 = Enabled, 0 = Disabled
                 CHECK (enabled IN (0, 1)),
    order_index  INTEGER NOT NULL DEFAULT 0,        -- For ordering rules in UI
    created_at   INTEGER NOT NULL                   -- Unix timestamp in ms
);

CREATE INDEX idx_scope_rules_scope_id ON scope_rules (scope_id);
CREATE INDEX idx_scope_rules_scope_type ON scope_rules (scope_id, rule_type, enabled);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. INTERCEPTOR & PROXY SETTINGS TABLE
-- Persists proxy intercept settings per project.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE interceptor_settings (
    project_id           TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requests_enabled     INTEGER NOT NULL DEFAULT 0 CHECK (requests_enabled IN (0, 1)),
    responses_enabled    INTEGER NOT NULL DEFAULT 0 CHECK (responses_enabled IN (0, 1)),
    scope_filter_enabled INTEGER NOT NULL DEFAULT 0 CHECK (scope_filter_enabled IN (0, 1)),
    updated_at           INTEGER NOT NULL
);
