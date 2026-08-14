ALTER TABLE replayer_collections ADD COLUMN is_expanded INTEGER NOT NULL DEFAULT 1;
ALTER TABLE replayer_collections ADD COLUMN is_selected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE replayer_sessions ADD COLUMN is_selected INTEGER NOT NULL DEFAULT 0;
