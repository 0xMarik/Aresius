-- Add temporary column to project_catalog
ALTER TABLE project_catalog ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0 CHECK (temporary IN (0, 1));
