-- Index for fuzzer payload sorting
CREATE INDEX IF NOT EXISTS idx_fuzzer_requests_sort_payload ON fuzzer_requests (run_id, payload);
