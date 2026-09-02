-- Migration 0016: Microsoft Teams private-channel columns + trigger rework
-- Companion to 0015_ms_teams.sql. That migration added ms_team_id/
-- ms_team_web_url/ms_team_created_at/ms_team_error for a Team created per
-- proposal on the 'signed' event. This migration adds columns for the
-- reworked model: one Team per Hotel Group (reused across every
-- proposal/property generated under that hgid), with one PRIVATE channel
-- per Property underneath it — and the trigger itself moved from 'signed'
-- to 'created' (worker/src/routes/proposals.ts's triggerTeamsWorkspace(),
-- renamed from triggerTeamsNotification()), so the workspace exists as
-- soon as the wizard's "Generate & Save" runs.
--
-- ms_team_id/ms_team_web_url (from 0015) now hold the Hotel Group's shared
-- Team; ms_channel_id/ms_channel_web_url (new here) hold this specific
-- proposal's Property channel within that Team.

ALTER TABLE proposals ADD COLUMN ms_channel_id       TEXT;
ALTER TABLE proposals ADD COLUMN ms_channel_web_url  TEXT;
