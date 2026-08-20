-- Add set_connection_keep_alive and update_content_length to fuzzer_sessions
ALTER TABLE fuzzer_sessions ADD COLUMN set_connection_keep_alive INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fuzzer_sessions ADD COLUMN update_content_length INTEGER NOT NULL DEFAULT 1;
