-- Migration 0015: Microsoft Teams client-team automation columns
-- Adds columns to record the outcome of triggerTeamsNotification()
-- (worker/src/routes/proposals.ts), which fires on the 'signed' automation
-- event and creates a new Microsoft Team named after the client
-- (proposals.hotel_name), with the proposal's sender and account manager
-- (staff.m365_user_id) added as owners.
--
-- ms_team_error is populated instead of ms_team_id/ms_team_web_url when
-- creation fails (e.g. missing m365_user_id on staff, insufficient Graph
-- app permissions) so the failure is visible on the proposal record itself,
-- not only in Worker logs — see schema.sql's comment on this table for the
-- silent-failure precedent this is meant to avoid.

ALTER TABLE proposals ADD COLUMN ms_team_id         TEXT;
ALTER TABLE proposals ADD COLUMN ms_team_web_url     TEXT;
ALTER TABLE proposals ADD COLUMN ms_team_created_at  TEXT;
ALTER TABLE proposals ADD COLUMN ms_team_error       TEXT;
