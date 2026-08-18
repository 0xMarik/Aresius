-- Add payload column and index to fuzzer_requests
ALTER TABLE fuzzer_requests ADD COLUMN payload TEXT;
CREATE INDEX IF NOT EXISTS idx_fuzzer_requests_sort_payload ON fuzzer_requests (run_id, payload);
