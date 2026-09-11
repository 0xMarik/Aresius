CREATE TABLE project_catalog (
    id             TEXT PRIMARY KEY NOT NULL,   -- same UUID as the project's own `projects.id`
    name           TEXT NOT NULL,
    path           TEXT NOT NULL UNIQUE,
    created_at     INTEGER NOT NULL,            -- Unix ms
    updated_at     INTEGER NOT NULL,            -- Unix ms
    last_opened_at INTEGER,                     -- Unix ms (NULL if never opened)
    version        TEXT NOT NULL DEFAULT '0.1.0',
    temporary      INTEGER NOT NULL DEFAULT 0 CHECK (temporary IN (0, 1))
);
