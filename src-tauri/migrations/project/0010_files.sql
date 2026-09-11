CREATE TABLE IF NOT EXISTS project_files (
    id          TEXT PRIMARY KEY NOT NULL,      -- UUID v4
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL DEFAULT '',       -- original file path if imported from disk
    size_bytes  INTEGER NOT NULL,
    line_count  INTEGER NOT NULL,
    content     TEXT NOT NULL,                  -- raw text content
    created_at  INTEGER NOT NULL,                -- Unix ms
    updated_at  INTEGER NOT NULL                 -- Unix ms
);

CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_created_at ON project_files(created_at);
