CREATE TABLE projects (
    id          TEXT PRIMARY KEY NOT NULL,          -- UUID v4
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    temporary   INTEGER NOT NULL DEFAULT 0
                CHECK (temporary IN (0, 1)),
    created_at  INTEGER NOT NULL,                    -- Unix ms
    updated_at  INTEGER NOT NULL                     -- Unix ms
);