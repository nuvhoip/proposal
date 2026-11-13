-- Migration 0026: editable default Background + Scope of Works intro text
-- (Settings › Body configuration, 2026-11-13).
--
-- document_text_defaults holds the staff-editable default wording; each new
-- proposal snapshots it onto proposals.background_text / scope_intro_text at
-- create time, so editing the defaults later never changes a proposal that
-- already exists (same "template, not a live link" rule as
-- service_categories.default_scope_json). Tokens [Property Name] and
-- [service] are resolved when the document renders.
--
-- Additive: NULL columns render the original built-in wording, so the
-- current worker/frontend keep working. Run it BEFORE deploying the worker
-- that reads it:
--   wrangler d1 execute nuvho-proposals --remote --file=migrations/0026_document_text_defaults.sql

CREATE TABLE IF NOT EXISTS document_text_defaults (
  key         TEXT PRIMARY KEY,           -- 'background' | 'scope_intro'
  value       TEXT NOT NULL DEFAULT '',
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO document_text_defaults (key, value) VALUES
  ('background',  '[Property Name] has engaged Nuvho to deliver [service], with a strong focus on maximising commercial performance and elevating the guest experience. This proposal outlines our recommended scope of works, fee structure and terms of engagement.'),
  ('scope_intro', 'We develop a long-term and collaborative partnership with our clients, delivering services and value across the spectrum of hotel operations.');

ALTER TABLE proposals ADD COLUMN background_text  TEXT;
ALTER TABLE proposals ADD COLUMN scope_intro_text TEXT;
