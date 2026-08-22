-- Add a version column to each project's local metadata table.
-- Mirrors project_catalog.version and acts as the single source of truth inside the .ares file.
ALTER TABLE projects ADD COLUMN version TEXT NOT NULL DEFAULT '0.1.0';
