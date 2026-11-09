-- Migration 0025: Account Manager list limited to team leaders (2026-11-10).
-- staff.is_account_manager = 1 marks who can be picked as Account Manager in
-- Step 1 (Hotel details). Managed in Settings › Account managers. Seeded with
-- the team leaders: Alana, Tess, Ody, Jude, Hayley, Riley, Rebecca, Matt.
--
-- Additive: the current worker ignores the column. Run it BEFORE deploying the
-- worker that reads it:
--   wrangler d1 execute nuvho-proposals --remote --file=migrations/0025_staff_account_manager.sql

ALTER TABLE staff ADD COLUMN is_account_manager INTEGER NOT NULL DEFAULT 0;

UPDATE staff SET is_account_manager = 1
WHERE lower(email) IN (
  'alana.karic@nuvho.com',
  'tess.temperley@nuvho.com',
  'odysseus.ambut@nuvho.com',
  'jude.bolger@nuvho.com',
  'hayley.thompson@nuvho.com',
  'riley.staraj@nuvho.com',
  'rebecca.janke@nuvho.com',
  'matthias.dybing@nuvho.com'
);
