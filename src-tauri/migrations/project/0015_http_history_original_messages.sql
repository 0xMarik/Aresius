ALTER TABLE http_history ADD COLUMN request_edit_type TEXT DEFAULT NULL;
ALTER TABLE http_history ADD COLUMN response_edit_type TEXT DEFAULT NULL;
ALTER TABLE http_history ADD COLUMN request_auto_patch TEXT DEFAULT NULL;
ALTER TABLE http_history ADD COLUMN request_manual_patch TEXT DEFAULT NULL;
ALTER TABLE http_history ADD COLUMN response_auto_patch TEXT DEFAULT NULL;
ALTER TABLE http_history ADD COLUMN response_manual_patch TEXT DEFAULT NULL;
