-- Migration 0017: NUVCL-151 — dedicated "Setup fee" column on pricing rows.
-- The fee table becomes Component | Fee type | Setup fee | Fee | Terms.
-- `fee` keeps holding the primary (usually recurring) amount; `setup_fee` is
-- the new one-off amount shown beside it. Nullable, no default: existing
-- rows read back as "no setup fee". The `note` column is left in place
-- (no longer shown anywhere) so older data isn't destroyed.
--
-- Run once against the live database BEFORE deploying the matching worker:
--   wrangler d1 execute nuvho-proposals --remote --file=migrations/0017_fee_rows_setup_fee.sql

ALTER TABLE proposal_fee_rows ADD COLUMN setup_fee REAL;
