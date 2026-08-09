CREATE TABLE project_catalog (
    id            TEXT PRIMARY KEY NOT NULL,   -- same UUID as the project's own `projects.id`
    name          TEXT NOT NULL,
    path          TEXT NOT NULL UNIQUE,
    created_at    INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);