-- ============================================================
-- Nuvho Proposal System — D1 Schema
-- ============================================================

-- ── Staff ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  role              TEXT NOT NULL,
  role_type         TEXT NOT NULL,
  bd_facing         INTEGER NOT NULL DEFAULT 1,
  is_signatory      INTEGER NOT NULL DEFAULT 0,
  hubspot_owner_id  TEXT,
  asana_gid         TEXT,
  m365_user_id      TEXT,
  m365_upn          TEXT,
  timezone          TEXT NOT NULL DEFAULT 'Australia/Sydney',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Proposals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposals (
  id                   TEXT PRIMARY KEY,
  np_id                TEXT UNIQUE,  -- client-facing "Proposal ID" (NP-{REGION}-{YYMMDD}-{6RAND}),
                                      -- reserved from register.nuvho.com POST /v1/np-ids at create time
  hotel_name           TEXT NOT NULL,
  contact_name         TEXT NOT NULL,
  contact_email        TEXT NOT NULL,
  contact_phone        TEXT,
  contact_title        TEXT,
  property_address     TEXT,
  region               TEXT NOT NULL DEFAULT 'au',
  status               TEXT NOT NULL DEFAULT 'draft',
  sender_staff_id      TEXT NOT NULL REFERENCES staff(id),
  sender_message       TEXT,
  cover_url            TEXT,
  pdf_url              TEXT,
  signed_pdf_url       TEXT,
  signer_name          TEXT,
  signed_at            TEXT,
  sent_at              TEXT,
  expires_at           TEXT,
  valid_until          TEXT,
  hubspot_deal_id      TEXT,
  hubspot_proposal_id  TEXT,
  asana_project_gid    TEXT,
  xero_quote_id        TEXT,
  sharepoint_folder    TEXT,
  view_count           INTEGER NOT NULL DEFAULT 0,
  last_viewed_at       TEXT,
  signing_token        TEXT UNIQUE,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proposals_status      ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_sender      ON proposals(sender_staff_id);
CREATE INDEX IF NOT EXISTS idx_proposals_hotel       ON proposals(hotel_name);
CREATE INDEX IF NOT EXISTS idx_proposals_signing_tok ON proposals(signing_token);
CREATE INDEX IF NOT EXISTS idx_proposals_created     ON proposals(created_at DESC);

-- ── Proposal Services ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_services (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  monthly_fee  REAL NOT NULL DEFAULT 0,
  setup_fee    REAL NOT NULL DEFAULT 0,
  term_months  INTEGER NOT NULL DEFAULT 12,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_proposal ON proposal_services(proposal_id);

-- ── Registry Sync (Nuvho Master Registry — register.nuvho.com) ──
-- One row per bundled service_line per proposal: the registry's proposal
-- record (POST /v1/proposals) only accepts a single service_line, but a
-- Nuvho proposal can bundle several (RM, SM, MK, CR…), so each service gets
-- its own canonical PROP-{GEO}-{YYYY}-{SEQ4} record, linked back here.
CREATE TABLE IF NOT EXISTS proposal_registry_links (
  id            TEXT PRIMARY KEY,
  proposal_id   TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_line  TEXT NOT NULL,
  hgid          TEXT NOT NULL,
  entity_code   TEXT NOT NULL,
  geo           TEXT NOT NULL,
  prop_id       TEXT,                  -- registry-assigned id; null until synced
  status        TEXT NOT NULL DEFAULT 'draft',
  sync_error    TEXT,
  synced_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prl_proposal ON proposal_registry_links(proposal_id);
CREATE INDEX IF NOT EXISTS idx_prl_prop_id  ON proposal_registry_links(prop_id);

-- ── Engagements ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagements (
  id              TEXT PRIMARY KEY,
  proposal_id     TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  hotel_name      TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  services        TEXT NOT NULL,
  start_date      TEXT NOT NULL,
  staff_id        TEXT NOT NULL REFERENCES staff(id),
  hubspot_deal_id TEXT,
  asana_project   TEXT,
  xero_invoice_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── SharePoint Folders ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sharepoint_folders (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  folder_url   TEXT NOT NULL,
  drive_id     TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Audit Log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  actor        TEXT,
  meta         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_proposal ON audit_log(proposal_id, created_at DESC);

-- ── Seed: default staff ───────────────────────────────────────
INSERT OR IGNORE INTO staff (id, name, email, role, role_type, bd_facing, is_signatory, timezone)
VALUES
  ('staff_jude', 'Jude Bolger', 'jude.bolger@nuvho.com', 'Director',        'bd',  1, 1, 'Australia/Sydney'),
  ('staff_emma', 'Emma Clarke', 'emma.clarke@nuvho.com', 'BD Manager',      'bd',  1, 0, 'Australia/Sydney'),
  ('staff_ryan', 'Ryan Nguyen', 'ryan.nguyen@nuvho.com', 'Revenue Manager', 'ops', 0, 0, 'Australia/Sydney');
