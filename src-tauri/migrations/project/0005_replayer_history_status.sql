ALTER TABLE replayer_history ADD COLUMN status TEXT NOT NULL DEFAULT '';
ALTER TABLE replayer_history ADD COLUMN error_message TEXT;
