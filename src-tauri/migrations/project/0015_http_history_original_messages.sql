ALTER TABLE http_history ADD COLUMN original_raw_request TEXT DEFAULT NULL;
ALTER TABLE http_history ADD COLUMN original_raw_response TEXT DEFAULT NULL;
