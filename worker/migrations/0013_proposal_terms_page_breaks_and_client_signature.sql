-- NUVCL-131: (1) per-category "Page Break" checkboxes on the wizard's
-- Preview & Save step (Step7Preview) — one JSON blob covering all
-- categories, following the same pattern as clauses_json. (2) dedicated
-- columns for the CLIENT's own captured e-signature from the public sign
-- page, kept separate from signatory_name/signature_method/
-- signature_data_url (the SENDER's own letter sign-off) so signProposal()
-- no longer overwrites the sender's sign-off with the client's signature,
-- and the client's signature can be rendered distinctly at the top of
-- Terms & Conditions in the generated document/PDF.
-- Paired with the same columns added to worker/schema.sql's proposal_terms
-- table, per this project's convention of shipping a numbered one-time
-- migration alongside every schema.sql change so already-deployed databases
-- can catch up.
--
-- Run against production with:
--   wrangler d1 execute <db-name> --remote --file=worker/migrations/0013_proposal_terms_page_breaks_and_client_signature.sql

ALTER TABLE proposal_terms ADD COLUMN page_breaks_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE proposal_terms ADD COLUMN client_signatory_name TEXT;
ALTER TABLE proposal_terms ADD COLUMN client_signatory_title TEXT;
ALTER TABLE proposal_terms ADD COLUMN client_signature_method TEXT;    -- 'type' | 'draw' | NULL (not signed yet)
ALTER TABLE proposal_terms ADD COLUMN client_signature_data_url TEXT;  -- drawn signature, base64 PNG data URL
ALTER TABLE proposal_terms ADD COLUMN client_signed_at TEXT;           -- ISO timestamp, set by signProposal()
