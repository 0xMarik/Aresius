-- Add a version column to project_catalog.
-- Populated from the project's own metadata on create / select.
ALTER TABLE project_catalog ADD COLUMN version TEXT NOT NULL DEFAULT '0.1.0';
