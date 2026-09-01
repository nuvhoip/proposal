-- Migration 0014: Engagement ID (EID) sync columns on proposal_registry_links
-- Adds columns to track each bundled service line's Master Registry
-- Engagement record (POST/PATCH /v1/engagements), independently of the
-- existing prop_id (Proposal record) sync columns already on this table --
-- see schema.sql's proposal_registry_links comment for why they're separate.
-- Paired with worker/src/lib/registry.ts's createEngagement/updateEngagement
-- and worker/src/routes/proposals.ts's createProposal/syncEngagementStatus.

ALTER TABLE proposal_registry_links ADD COLUMN pid            TEXT;
ALTER TABLE proposal_registry_links ADD COLUMN eid            TEXT;
ALTER TABLE proposal_registry_links ADD COLUMN eid_display    TEXT;
ALTER TABLE proposal_registry_links ADD COLUMN eid_sync_error TEXT;
ALTER TABLE proposal_registry_links ADD COLUMN eid_synced_at  TEXT;

CREATE INDEX IF NOT EXISTS idx_prl_eid ON proposal_registry_links(eid);
