-- Add pipeline preprocessing columns to fuzzer_sessions and fuzzer_parameters
ALTER TABLE fuzzer_sessions ADD COLUMN pipeline_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE fuzzer_sessions ADD COLUMN pipeline_rules TEXT NOT NULL DEFAULT '[]';
ALTER TABLE fuzzer_parameters ADD COLUMN pipeline_rules TEXT NOT NULL DEFAULT '[]';
