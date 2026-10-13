-- Migration 0021: default fee configuration (Settings → Default fees).
-- fee_configurations is a library of reusable default fee rows; the
-- service_line_fee_configurations mapping table links each one to any number
-- of service lines (service_categories.code), in order. When a service line
-- is added to a NEW proposal, its Pricing rows are pre-filled from its mapped
-- fee configurations (frontend initFeeRows) — the built-in catalog defaults
-- are only the fallback for a service line with no mapping. Like the other
-- Settings templates, editing these never changes existing proposals.
--
-- Run once against the live database BEFORE deploying the matching worker:
--   wrangler d1 execute nuvho-proposals --remote --file=migrations/0021_fee_configurations.sql

CREATE TABLE IF NOT EXISTS fee_configurations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                      -- label in Settings only
  component   TEXT NOT NULL DEFAULT '',           -- "Component" column in the document
  fee_type    TEXT NOT NULL DEFAULT 'monthly',    -- known code (monthly/setup/fixed/…) or free text
  setup_fee   REAL,                               -- NULL = none
  fee         REAL,                               -- NULL = left blank for staff to fill in
  term        INTEGER,                            -- months; NULL = none
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_line_fee_configurations (
  service_code         TEXT NOT NULL REFERENCES service_categories(code) ON DELETE CASCADE,
  fee_configuration_id TEXT NOT NULL REFERENCES fee_configurations(id) ON DELETE CASCADE,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (service_code, fee_configuration_id)
);
CREATE INDEX IF NOT EXISTS idx_slfc_service ON service_line_fee_configurations(service_code, sort_order);
CREATE INDEX IF NOT EXISTS idx_slfc_fee     ON service_line_fee_configurations(fee_configuration_id);

-- Seed: the built-in catalog defaults (frontend/lib/serviceCatalog.ts), so
-- new proposals pre-fill exactly as before until staff change them. One
-- shared "Setup Fee" row is mapped to both RM and CR.
INSERT OR IGNORE INTO fee_configurations (id, name, component, fee_type, setup_fee, fee, term) VALUES
  ('feecfg_setup_1500',        'Setup Fee — $1,500',            'Setup Fee',            'setup',   NULL, 1500, NULL),
  ('feecfg_rm_monthly',        'RM Monthly Management',         'Monthly Management',   'monthly', NULL, 7499, 12),
  ('feecfg_sm_setup_outlet',   'SM Setup Fee per Outlet',       'Setup Fee per Outlet', 'setup',   NULL, 1500, NULL),
  ('feecfg_sm_retainer',       'SM Monthly Retainer',           'Monthly Retainer',     'monthly', NULL, 8500, 6),
  ('feecfg_cr_monthly',        'CR Monthly Fee',                'Monthly Fee',          'monthly', NULL, 5999, 12),
  ('feecfg_cr_after_hours',    'CR After Hours (optional)',     'After Hours',          'monthly', NULL, NULL, 12),
  ('feecfg_mk_retainer',       'MK Monthly Retainer',           'Monthly Retainer',     'monthly', NULL, NULL, NULL);

-- One statement per link (D1 rejects a long UNION ALL: "too many terms in
-- compound SELECT"). Each only inserts if that service line exists, so the
-- file can be re-run safely.
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'RM', 'feecfg_setup_1500', 1 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'RM');
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'RM', 'feecfg_rm_monthly', 2 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'RM');
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'SM', 'feecfg_sm_setup_outlet', 1 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'SM');
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'SM', 'feecfg_sm_retainer', 2 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'SM');
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'CR', 'feecfg_setup_1500', 1 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'CR');
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'CR', 'feecfg_cr_monthly', 2 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'CR');
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'CR', 'feecfg_cr_after_hours', 3 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'CR');
INSERT OR IGNORE INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
  SELECT 'MK', 'feecfg_mk_retainer', 1 WHERE EXISTS (SELECT 1 FROM service_categories WHERE code = 'MK');
